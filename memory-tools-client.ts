import tls from "node:tls";
import net from "node:net";
import fs from "node:fs";
import { Buffer } from "node:buffer";

// --- Protocol Constants (must match internal/protocol/protocol.go) ---
// COMMAND TYPES
const CMD_SET = 1;
const CMD_GET = 2;
const CMD_COLLECTION_CREATE = 3;
const CMD_COLLECTION_DELETE = 4;
const CMD_COLLECTION_LIST = 5;
const CMD_COLLECTION_ITEM_SET = 6;
const CMD_COLLECTION_ITEM_GET = 7;
const CMD_COLLECTION_ITEM_DELETE = 8;
const CMD_COLLECTION_ITEM_LIST = 9;
const CMD_COLLECTION_QUERY = 10; // NEW: QUERY_COLLECTION collectionName, query_json
const CMD_AUTHENTICATE = 11;     // AUTH username, password

// RESPONSE STATUS
const STATUS_OK = 1;
const STATUS_NOT_FOUND = 2;
const STATUS_ERROR = 3;
const STATUS_BAD_COMMAND = 4;
const STATUS_UNAUTHORIZED = 5;
const STATUS_BAD_REQUEST = 6;

// Helper function to get status string for better error messages
function getStatusString(status: number): string {
  switch (status) {
    case STATUS_OK: return "OK";
    case STATUS_NOT_FOUND: return "NOT_FOUND";
    case STATUS_ERROR: return "ERROR";
    case STATUS_BAD_COMMAND: return "BAD_COMMAND";
    case STATUS_UNAUTHORIZED: return "UNAUTHORIZED";
    case STATUS_BAD_REQUEST: return "BAD_REQUEST";
    default: return "UNKNOWN_STATUS";
  }
}

// Interface for command responses from the server
interface CommandResponse {
  status: number;
  message: string;
  data: Buffer;
}

// Interface for GET operation results
interface GetResult<T = any> {
  found: boolean;
  message: string;
  value: T | null;
}

// Interface for COLLECTION_LIST operation result
interface CollectionListResult {
  message: string;
  names: string[];
}

// Interface for COLLECTION_ITEM_LIST operation result
interface CollectionItemListResult<T = any> {
  message: string;
  items: { [key: string]: T };
}

// Query defines the structure for a collection query command,
// encompassing filtering, ordering, limiting, and aggregation.
interface Query {
  filter?: { [key: string]: any }; // WHERE clause equivalents (AND, OR, NOT, LIKE, BETWEEN, IN, IS NULL)
  orderBy?: OrderByClause[];     // ORDER BY clause
  limit?: number;                // LIMIT clause
  offset?: number;               // OFFSET clause
  count?: boolean;               // COUNT(*) equivalent
  aggregations?: { [key: string]: Aggregation }; // SUM, AVG, MIN, MAX
  groupBy?: string[];            // GROUP BY clause
  having?: { [key: string]: any }; // HAVING clause (filters aggregated results)
  distinct?: string;             // DISTINCT field
}

// OrderByClause defines a single ordering criterion.
interface OrderByClause {
  field: string;
  direction: "asc" | "desc"; // "asc" or "desc"
}

// Aggregation defines an aggregation function.
interface Aggregation {
  func: "sum" | "avg" | "min" | "max" | "count";
  field: string; // Field to aggregate on, "*" for count
}


// Helper: Writes a length-prefixed string (uint32 length + string bytes)
function writeString(str: string): Buffer {
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(Buffer.byteLength(str, "utf8"), 0); // Use Little Endian (LE) matching Go's binary.LittleEndian
  return Buffer.concat([lenBuffer, Buffer.from(str, "utf8")]);
}

// Helper: Writes a length-prefixed byte array (uint32 length + byte array)
function writeBytes(bytes: Buffer): Buffer {
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(bytes.length, 0); // Use Little Endian (LE) matching Go's binary.LittleEndian
  return Buffer.concat([lenBuffer, bytes]);
}

// Helper to read N bytes from the socket, handling partial reads
function readNBytes(socket: tls.TLSSocket, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (n === 0) {
      return resolve(Buffer.alloc(0));
    }

    const buffer = Buffer.alloc(n);
    let bytesRead = 0;

    const onData = (chunk: Buffer) => {
      const bytesToCopy = Math.min(chunk.length, n - bytesRead);
      chunk.copy(buffer, bytesRead, 0, bytesToCopy);
      bytesRead += bytesToCopy;

      if (bytesRead >= n) {
        socket.removeListener("data", onData);
        socket.removeListener("error", onError);
        resolve(buffer.slice(0, n)); // Resolve with exactly N bytes
      }
    };

    const onError = (err: Error) => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      reject(err);
    };

    socket.on("data", onData);
    socket.on("error", onError);
  });
}

// --- DB Client Class ---
export class MemoryToolsClient {
  private host: string;
  private port: number;
  private username: string | null;
  private password: string | null;
  private serverCertPath: string | null;
  private rejectUnauthorized: boolean;
  private socket: tls.TLSSocket | null;
  private connectingPromise: Promise<tls.TLSSocket> | null;
  private isAuthenticatedSession: boolean;
  private authenticatedUser: string | null;

  constructor(
    host: string,
    port: number,
    username: string | null = null,
    password: string | null = null,
    serverCertPath: string | null = null,
    rejectUnauthorized: boolean = true
  ) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    this.serverCertPath = serverCertPath;
    this.rejectUnauthorized = rejectUnauthorized;
    this.socket = null;
    this.connectingPromise = null;
    this.isAuthenticatedSession = false;
    this.authenticatedUser = null;
  }

  /**
   * Establishes a TLS connection to the database server and performs authentication.
   * If username and password are provided in the constructor, it will attempt to log in automatically.
   * @returns The TLS socket if connection and authentication are successful.
   * @throws An error if connection or authentication fails.
   */
  async connect(): Promise<tls.TLSSocket> {
    // If already connected and authenticated, just return the socket.
    if (this.socket && !this.socket.destroyed && this.isAuthenticatedSession) {
      console.log("DBClient: Already connected and authenticated.");
      return this.socket;
    }

    // If a connection attempt is already in progress, return that promise.
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    // Start a new connection attempt.
    this.connectingPromise = new Promise(async (resolve, reject) => {
      let serverCert: Buffer | undefined = undefined;
      if (this.serverCertPath) {
        try {
          serverCert = fs.readFileSync(this.serverCertPath);
        } catch (err: any) {
          this.connectingPromise = null; // Reset promise on error
          return reject(
            new Error(
              `DBClient: Failed to read server certificate file: ${err.message}`
            )
          );
        }
      }

      const options: tls.ConnectionOptions = {
        host: this.host,
        port: this.port,
        ca: serverCert ? [serverCert] : undefined,
        rejectUnauthorized: this.rejectUnauthorized,
        checkServerIdentity: (host: string, cert: tls.PeerCertificate) => {
          if (cert.subject && cert.subject.CN === this.host) {
            return undefined;
          }
          if (cert.subjectaltname) {
            if (net.isIP(this.host) && cert.subjectaltname.includes(`IP:${this.host}`)) {
                return undefined;
            }
            if (this.host === "localhost" && cert.subjectaltname.includes("DNS:localhost")) {
                return undefined;
            }
            const dnsSANs = cert.subjectaltname.split(', ').filter(s => s.startsWith('DNS:')).map(s => s.substring(4));
            if (dnsSANs.includes(this.host)) {
                return undefined;
            }
          }
          console.warn(
            `DBClient: WARNING - Server certificate identity check failed for host ${
              this.host
            }. CN: ${cert.subject ? cert.subject.CN : "N/A"}, SANs: ${
              cert.subjectaltname || "N/A"
            }. Proceeding if rejectUnauthorized is false.`
          );
          return undefined; // Returning undefined means the check "passed" (or was ignored if rejectUnauthorized is false)
        },
      };

      this.socket = tls.connect(options, async () => {
        if (this.socket!.authorized || !this.rejectUnauthorized) {
          console.log(`DBClient: Connected securely to ${this.host}:${this.port}`);
          
          if (this.username && this.password) {
            try {
              // This calls performAuthentication, which sends CMD_AUTHENTICATE.
              await this.performAuthentication(this.username, this.password);
              resolve(this.socket!); // Resolve the 'connect' promise ONLY AFTER successful authentication.
            } catch (authErr: any) {
              this.socket?.destroy(); // Close socket on authentication failure
              this.connectingPromise = null; // Reset promise
              reject(authErr); // Reject the 'connect' promise with the authentication error
            }
          } else {
            console.warn("DBClient: Connected without credentials. Operations might be unauthorized.");
            this.connectingPromise = null; // Reset promise
            resolve(this.socket!); // Resolve if no credentials provided (but server might deny commands)
          }

        } else {
          const authError = this.socket!.authorizationError;
          console.error(`DBClient: TLS connection unauthorized: ${authError}`);
          this.socket?.destroy();
          this.connectingPromise = null;
          reject(new Error(`DBClient: TLS connection unauthorized: ${authError}`));
        }
      });

      this.socket.on("error", (err: Error) => {
        console.error(`DBClient: Socket error: ${err.message}`);
        this.socket = null;
        this.connectingPromise = null;
        this.isAuthenticatedSession = false;
        this.authenticatedUser = null;
        reject(err);
      });

      this.socket.on("close", () => {
        console.log("DBClient: Socket connection closed.");
        this.socket = null;
        this.connectingPromise = null;
        this.isAuthenticatedSession = false;
        this.authenticatedUser = null;
      });
    });
    return this.connectingPromise;
  }

  /**
   * Internal method to perform the authentication command.
   * This method sends the CMD_AUTHENTICATE command and processes its response.
   * @param username The username.
   * @param password The password.
   * @returns A success message if authentication is successful.
   * @throws An error if authentication fails.
   */
  private async performAuthentication(username: string, password: string): Promise<string> {
    // Ensure socket is available before sending auth command
    if (!this.socket || this.socket.destroyed) {
        throw new Error("DBClient: Cannot perform authentication, socket is not connected.");
    }

    const usernameBuffer = writeString(username);
    const passwordBuffer = writeString(password);
    const payload = Buffer.concat([usernameBuffer, passwordBuffer]);

    const commandBuffer = Buffer.concat([
      Buffer.from([CMD_AUTHENTICATE]), // Explicitly send CMD_AUTHENTICATE
      payload,
    ]);

    // Log the command buffer for debugging
    // console.log("DBClient: Sending AUTH command. First byte (CMD_AUTHENTICATE):", commandBuffer[0]);
    // console.log("DBClient: Full AUTH command buffer (hex):", commandBuffer.toString('hex'));

    this.socket.write(commandBuffer);

    // Read response (status, message, data)
    const statusByte = await readNBytes(this.socket, 1);
    const status = statusByte.readUInt8(0);

    const msgLenBuffer = await readNBytes(this.socket, 4);
    const msgLen = msgLenBuffer.readUInt32LE(0); // Little Endian
    const msgBuffer = await readNBytes(this.socket, msgLen);
    const message = msgBuffer.toString("utf8");

    const dataLenBuffer = await readNBytes(this.socket, 4);
    const dataLen = dataLenBuffer.readUInt32LE(0); // Little Endian
    let dataBuffer = Buffer.alloc(0);
    if (dataLen > 0) {
      dataBuffer = await readNBytes(this.socket, dataLen);
    }
    
    // Process authentication response
    if (status === STATUS_OK) {
      this.isAuthenticatedSession = true;
      this.authenticatedUser = username;
      console.log(`DBClient: Authentication successful for user '${username}'.`);
      return message;
    } else {
      this.isAuthenticatedSession = false;
      this.authenticatedUser = null;
      // Provide more specific error for unauthorized authentication attempts
      const errorMessage = status === STATUS_UNAUTHORIZED
        ? `Authentication failed: ${message}` // Server specific unauthorized message
        : `Authentication failed with status ${getStatusString(status)} (${status}): ${message}`;
      throw new Error(errorMessage);
    }
  }


  /**
   * Sends a command and reads its response from the server.
   * Requires the client to be connected and authenticated (unless it's CMD_AUTHENTICATE).
   */
  private async sendCommand(
    commandType: number,
    payloadBuffer: Buffer
  ): Promise<CommandResponse> {
    // Ensure the socket is connected
    if (!this.socket || this.socket.destroyed) {
        throw new Error("DBClient: Not connected. Call connect() first.");
    }

    // Ensure the session is authenticated for any command other than CMD_AUTHENTICATE
    if (commandType !== CMD_AUTHENTICATE && !this.isAuthenticatedSession) {
        throw new Error("DBClient: Not authenticated. Call connect() with credentials to authenticate.");
    }

    const commandBuffer = Buffer.concat([
      Buffer.from([commandType]),
      payloadBuffer,
    ]);

    // Log the command buffer for debugging
    // console.log(`DBClient: Sending command ${commandType}. First byte:`, commandBuffer[0]);
    // console.log(`DBClient: Full command buffer for ${commandType} (hex):`, commandBuffer.toString('hex'));

    this.socket.write(commandBuffer);

    // Read response (status, message, data)
    const statusByte = await readNBytes(this.socket, 1);
    const status = statusByte.readUInt8(0);

    const msgLenBuffer = await readNBytes(this.socket, 4);
    const msgLen = msgLenBuffer.readUInt32LE(0);
    const msgBuffer = await readNBytes(this.socket, msgLen);
    const message = msgBuffer.toString("utf8");

    const dataLenBuffer = await readNBytes(this.socket, 4);
    const dataLen = dataLenBuffer.readUInt32LE(0);
    let dataBuffer = Buffer.alloc(0);
    if (dataLen > 0) {
      dataBuffer = await readNBytes(this.socket, dataLen);
    }

    return { status, message, data: dataBuffer };
  }

  // --- Public API Methods ---

  /**
   * Sets a key-value pair in the main store.
   * @param key The key to set.
   * @param value The value to store (will be JSON.stringified).
   * @param ttlSeconds Optional time-to-live in seconds (0 for no expiry).
   * @returns A success message from the server.
   * @throws An error if the operation fails.
   */
  async set<T = any>(
    key: string,
    value: T,
    ttlSeconds: number = 0
  ): Promise<string> {
    const keyBuffer = writeString(key);
    const valueBuffer = writeBytes(Buffer.from(JSON.stringify(value))); // Value is JSON stringified
    const ttlBuffer = Buffer.alloc(8);
    ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0); // int64 in Go is BigInt in JS

    const payload = Buffer.concat([keyBuffer, valueBuffer, ttlBuffer]);
    const response = await this.sendCommand(CMD_SET, payload);

    if (response.status !== STATUS_OK) {
      throw new Error(`SET failed: ${getStatusString(response.status)}: ${response.message}`);
    }
    return response.message;
  }

  /**
   * Retrieves a value from the main store by key.
   * @param key The key to retrieve.
   * @returns A GetResult object indicating if found, message, and the parsed value.
   * @throws An error if the operation fails or value cannot be parsed.
   */
  async get<T = any>(key: string): Promise<GetResult<T>> {
    const keyBuffer = writeString(key);
    const payload = keyBuffer; // GET command only needs the key

    const response = await this.sendCommand(CMD_GET, payload);

    if (response.status === STATUS_NOT_FOUND) {
      return { found: false, message: response.message, value: null };
    }
    if (response.status !== STATUS_OK) {
      throw new Error(`GET failed: ${getStatusString(response.status)}: ${response.message}`);
    }

    try {
      return {
        found: true,
        message: response.message,
        value: JSON.parse(response.data.toString("utf8")) as T,
      };
    } catch (e: any) {
      console.error(
        `DBClient: Error parsing GET value as JSON: ${
          e.message
        }. Raw: ${response.data.toString("utf8")}`
      );
      throw new Error(`GET failed: Invalid JSON format for stored value.`);
    }
  }

  /**
   * Ensures a collection exists (creates it if it doesn't).
   * @param collectionName The name of the collection.
   * @returns A success message from the server.
   * @throws An error if the operation fails (e.g., unauthorized to create _system).
   */
  async collectionCreate(collectionName: string): Promise<string> {
    const payload = writeString(collectionName);
    const response = await this.sendCommand(CMD_COLLECTION_CREATE, payload);
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_CREATE failed: ${getStatusString(response.status)}: ${response.message}`);
    }
    return response.message;
  }

  /**
   * Deletes a collection entirely.
   * @param collectionName The name of the collection to delete.
   * @returns A success message from the server.
   * @throws An error if the operation fails (e.g., unauthorized to delete _system).
   */
  async collectionDelete(collectionName: string): Promise<string> {
    const payload = writeString(collectionName);
    const response = await this.sendCommand(CMD_COLLECTION_DELETE, payload);
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_DELETE failed: ${getStatusString(response.status)}: ${response.message}`);
    }
    return response.message;
  }

  /**
   * Lists all available collection names.
   * @returns A CollectionListResult object containing the message and an array of collection names.
   * @throws An error if the operation fails.
   */
  async collectionList(): Promise<CollectionListResult> {
    const payload = Buffer.alloc(0); // LIST_COLLECTIONS command has no payload
    const response = await this.sendCommand(CMD_COLLECTION_LIST, payload);
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_LIST failed: ${getStatusString(response.status)}: ${response.message}`);
    }
    try {
      const names = JSON.parse(response.data.toString("utf8")) as string[];
      return { message: response.message, names: names };
    } catch (e: any) {
      console.error(
        `DBClient: Error parsing COLLECTION_LIST response as JSON: ${
          e.message
        }. Raw: ${response.data.toString("utf8")}`
      );
      throw new Error(
        `COLLECTION_LIST failed: Invalid JSON format for collection names.`
      );
    }
  }

  /**
   * Sets an item (key-value pair) within a specific collection.
   * @param collectionName The name of the collection.
   * @param key The key of the item.
   * @param value The value to store (will be JSON.stringified).
   * @param ttlSeconds Optional time-to-live in seconds (0 for no expiry).
   * @returns A success message from the server.
   * @throws An error if the operation fails.
   */
  async collectionItemSet<T = any>(
    collectionName: string,
    key: string,
    value: T,
    ttlSeconds: number = 0
  ): Promise<string> {
    const collectionNameBuffer = writeString(collectionName);
    const keyBuffer = writeString(key);
    const valueBuffer = writeBytes(Buffer.from(JSON.stringify(value))); // Value is JSON stringified
    const ttlBuffer = Buffer.alloc(8);
    ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0); // int64 in Go is BigInt in JS

    const payload = Buffer.concat([
      collectionNameBuffer,
      keyBuffer,
      valueBuffer,
      ttlBuffer,
    ]);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_SET, payload);

    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_ITEM_SET failed: ${getStatusString(response.status)}: ${response.message}`);
    }
    return response.message;
  }

  /**
   * Retrieves an item from a specific collection by key.
   * @param collectionName The name of the collection.
   * @param key The key of the item.
   * @returns A GetResult object indicating if found, message, and the parsed value.
   * @throws An error if the operation fails or value cannot be parsed.
   */
  async collectionItemGet<T = any>(
    collectionName: string,
    key: string
  ): Promise<GetResult<T>> {
    const collectionNameBuffer = writeString(collectionName);
    const keyBuffer = writeString(key);
    const payload = Buffer.concat([collectionNameBuffer, keyBuffer]);

    const response = await this.sendCommand(CMD_COLLECTION_ITEM_GET, payload);

    if (response.status === STATUS_NOT_FOUND) {
      return { found: false, message: response.message, value: null };
    }
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_ITEM_GET failed: ${getStatusString(response.status)}: ${response.message}`);
    }

    try {
      // For single GETs, data is raw JSON bytes.
      return {
        found: true,
        message: response.message,
        value: JSON.parse(response.data.toString("utf8")) as T,
      };
    } catch (e: any) {
      console.error(
        `DBClient: Error parsing COLLECTION_ITEM_GET value as JSON: ${
          e.message
        }. Raw: ${response.data.toString("utf8")}`
      );
      throw new Error(
        `COLLECTION_ITEM_GET failed: Invalid JSON format for stored value.`
      );
    }
  }

  /**
   * Deletes an item from a specific collection by key.
   * @param collectionName The name of the collection.
   * @param key The key of the item to delete.
   * @returns A success message from the server.
   * @throws An error if the operation fails.
   */
  async collectionItemDelete(
    collectionName: string,
    key: string
  ): Promise<string> {
    const collectionNameBuffer = writeString(collectionName);
    const keyBuffer = writeString(key);
    const payload = Buffer.concat([collectionNameBuffer, keyBuffer]);

    const response = await this.sendCommand(
      CMD_COLLECTION_ITEM_DELETE,
      payload
    );

    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_ITEM_DELETE failed: ${getStatusString(response.status)}: ${response.message}`);
    }
    return response.message;
  }

  /**
   * Lists all items (key-value pairs) within a specific collection.
   * @param collectionName The name of the collection.
   * @returns A CollectionItemListResult object containing the message and a map of items.
   * @throws An error if the operation fails.
   */
  async collectionItemList<T = any>(
    collectionName: string
  ): Promise<CollectionItemListResult<T>> {
    const payload = writeString(collectionName);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_LIST, payload);

    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_ITEM_LIST failed: ${getStatusString(response.status)}: ${response.message}`);
    }

    const rawMap: { [key: string]: string } = JSON.parse(
      response.data.toString("utf8")
    ); // Go server returns map[string]string (where value is Base64 or direct JSON for _system)
    const decodedMap: { [key: string]: T } = {};

    for (const key in rawMap) {
      try {
        // Special handling for _system collection: values are directly JSON objects (sanitized by server)
        // This mirrors the Go client's `isCollectionItemListSystemCmd` logic.
        if (collectionName === "_system" && key.startsWith("user:")) {
            decodedMap[key] = JSON.parse(rawMap[key]) as T;
        } else {
            // For all other collections, values are Base64 encoded JSON, as seen in Go client's `readResponse`.
            const decodedVal = Buffer.from(rawMap[key], "base64");
            decodedMap[key] = JSON.parse(decodedVal.toString("utf8")) as T;
        }
      } catch (e: any) {
        console.warn(
          `DBClient: Warning - Failed to decode or parse JSON for key '${key}' in collection item list: ${e.message}. Raw: ${rawMap[key]}`
        );
        decodedMap[key] = rawMap[key] as T; // Fallback to raw string if parsing fails
      }
    }
    return { message: response.message, items: decodedMap };
  }

  /**
   * Executes a complex query on a specific collection.
   * @param collectionName The name of the collection.
   * @param query The Query object defining filter, order, limit, aggregations, etc.
   * @returns The query results as a generic type.
   * @throws An error if the operation fails or query JSON is invalid.
   */
  async collectionQuery<T = any>(collectionName: string, query: Query): Promise<T> {
    const collectionNameBuffer = writeString(collectionName);
    const queryJSONBuffer = writeBytes(Buffer.from(JSON.stringify(query))); // Query object as JSON bytes

    const payload = Buffer.concat([collectionNameBuffer, queryJSONBuffer]);
    const response = await this.sendCommand(CMD_COLLECTION_QUERY, payload);

    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_QUERY failed: ${getStatusString(response.status)}: ${response.message}`);
    }

    try {
      // The Go server sends query results directly as JSON, without Base64 encoding.
      return JSON.parse(response.data.toString("utf8")) as T;
    } catch (e: any) {
      console.error(
        `DBClient: Error parsing COLLECTION_QUERY result as JSON: ${
          e.message
        }. Raw: ${response.data.toString("utf8")}`
      );
      throw new Error(`COLLECTION_QUERY failed: Invalid JSON format for query results.`);
    }
  }


  /**
   * Returns true if the current client session is authenticated.
   */
  isSessionAuthenticated(): boolean {
    return this.isAuthenticatedSession;
  }

  /**
   * Returns the username of the currently authenticated user, or null if not authenticated.
   */
  getAuthenticatedUsername(): string | null {
    return this.authenticatedUser;
  }

  // Closes the underlying socket connection.
  close(): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
    }
    this.isAuthenticatedSession = false;
    this.authenticatedUser = null;
  }
}

// Export the client for use in other modules.
export default MemoryToolsClient;
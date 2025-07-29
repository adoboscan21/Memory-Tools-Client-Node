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
const CMD_AUTHENTICATE = 10;       // New: AUTH username, password
// CMD_CHANGE_USER_PASSWORD = 11; // Removed as per your clarification

// RESPONSE STATUS
const STATUS_OK = 1;
const STATUS_NOT_FOUND = 2;
const STATUS_ERROR = 3;
const STATUS_BAD_COMMAND = 4;
const STATUS_UNAUTHORIZED = 5; // New: Unauthorized access.
const STATUS_BAD_REQUEST = 6;  // New: Bad request (e.g., empty key/name).

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

// Custom interface for _system collection user data (sanitized by server)
interface SystemUserItem {
    username: string;
    is_root: boolean; // Note: server sends this as a string "true" / "false"
}

// Helper: Writes a length-prefixed string (uint32 length + string bytes)
function writeString(str: string): Buffer {
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(Buffer.byteLength(str, "utf8"), 0);
  return Buffer.concat([lenBuffer, Buffer.from(str, "utf8")]);
}

// Helper: Writes a length-prefixed byte array (uint32 length + byte array)
function writeBytes(bytes: Buffer): Buffer {
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([lenBuffer, bytes]);
}

// Helper to read N bytes from the socket, handling partial reads
function readNBytes(socket: tls.TLSSocket, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // If n is 0, resolve immediately with an empty buffer.
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
  private username: string | null; // New: Username for authentication
  private password: string | null; // New: Password for authentication
  private serverCertPath: string | null;
  private rejectUnauthorized: boolean;
  private socket: tls.TLSSocket | null;
  private connectingPromise: Promise<tls.TLSSocket> | null;
  private isAuthenticatedSession: boolean; // Renamed to avoid confusion with method name
  private authenticatedUser: string | null;

  constructor(
    host: string,
    port: number,
    username: string | null = null, // Added username
    password: string | null = null, // Added password
    serverCertPath: string | null = null,
    rejectUnauthorized: boolean = true
  ) {
    this.host = host;
    this.port = port;
    this.username = username; // Store username
    this.password = password; // Store password
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
    if (this.socket && !this.socket.destroyed) {
      console.log("DBClient: Already connected.");
      // If already connected, but not authenticated yet (e.g., manual connect without credentials, then call login),
      // we could re-attempt login here if credentials are now set, but current design assumes credentials via constructor.
      // For simplicity matching "connect and authenticate" pattern, we assume credentials are set at constructor.
      if (!this.isAuthenticatedSession && this.username && this.password) {
        console.log("DBClient: Re-authenticating on existing connection.");
        await this.performAuthentication(this.username, this.password);
      }
      return this.socket;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = new Promise(async (resolve, reject) => {
      let serverCert: Buffer | undefined = undefined;
      if (this.serverCertPath) {
        try {
          serverCert = fs.readFileSync(this.serverCertPath);
        } catch (err: any) {
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
          return undefined;
        },
      };

      this.socket = tls.connect(options, async () => { // Marked as async
        if (this.socket!.authorized || !this.rejectUnauthorized) {
          console.log(`DBClient: Connected securely to ${this.host}:${this.port}`);
          
          if (this.username && this.password) {
            try {
              await this.performAuthentication(this.username, this.password);
              resolve(this.socket!); // Resolve only after successful authentication
            } catch (authErr: any) {
              this.socket?.destroy(); // Close socket on auth failure
              reject(authErr);
            }
          } else {
            console.warn("DBClient: Connected without credentials. Operations might be unauthorized.");
            resolve(this.socket!); // Resolve if no credentials provided (but server might deny commands)
          }

        } else {
          const authError = this.socket!.authorizationError;
          console.error(`DBClient: TLS connection unauthorized: ${authError}`);
          reject(new Error(`DBClient: TLS connection unauthorized: ${authError}`));
        }
      });

      this.socket.on("error", (err: Error) => {
        console.error(`DBClient: Socket error: ${err.message}`);
        reject(err);
        this.socket = null;
        this.connectingPromise = null;
        this.isAuthenticatedSession = false;
        this.authenticatedUser = null;
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
   * @param username The username.
   * @param password The password.
   * @returns A success message if authentication is successful.
   * @throws An error if authentication fails.
   */
  private async performAuthentication(username: string, password: string): Promise<string> {
    const usernameBuffer = writeString(username);
    const passwordBuffer = writeString(password);
    const payload = Buffer.concat([usernameBuffer, passwordBuffer]);

    const response = await this.sendCommand(CMD_AUTHENTICATE, payload);

    if (response.status === STATUS_OK) {
      this.isAuthenticatedSession = true;
      this.authenticatedUser = username;
      console.log(`DBClient: Authentication successful for user '${username}'.`);
      return response.message;
    } else if (response.status === STATUS_UNAUTHORIZED) {
      this.isAuthenticatedSession = false;
      this.authenticatedUser = null;
      throw new Error(`Authentication failed: ${response.message}`);
    } else {
      this.isAuthenticatedSession = false;
      this.authenticatedUser = null;
      throw new Error(
        `Authentication failed with status ${getStatusString(response.status)} (${response.status}): ${response.message}`
      );
    }
  }


  // Sends a command and reads its response from the server
  private async sendCommand(
    commandType: number,
    payloadBuffer: Buffer
  ): Promise<CommandResponse> {
    // Check if the socket is ready, otherwise try to connect (or re-authenticate if connection exists but session is not authenticated)
    if (!this.socket || this.socket.destroyed || !this.isAuthenticatedSession && commandType !== CMD_AUTHENTICATE) {
        // If not authenticated for non-auth commands, throw an error
        if (commandType !== CMD_AUTHENTICATE) {
            throw new Error("DBClient: Not connected or not authenticated. Please call connect() with credentials first.");
        }
        // If it's an AUTH command, ensure we have a connection
        if (!this.socket || this.socket.destroyed) {
            await this.connect(); // This will also handle authentication if credentials are in constructor
        }
    }

    const commandBuffer = Buffer.concat([
      Buffer.from([commandType]),
      payloadBuffer,
    ]);

    this.socket!.write(commandBuffer);

    // Read response (status, message, data)
    const statusByte = await readNBytes(this.socket!, 1);
    const status = statusByte.readUInt8(0);

    const msgLenBuffer = await readNBytes(this.socket!, 4);
    const msgLen = msgLenBuffer.readUInt32LE(0);
    const msgBuffer = await readNBytes(this.socket!, msgLen);
    const message = msgBuffer.toString("utf8");

    const dataLenBuffer = await readNBytes(this.socket!, 4);
    const dataLen = dataLenBuffer.readUInt32LE(0);
    let dataBuffer = Buffer.alloc(0);
    if (dataLen > 0) {
      dataBuffer = await readNBytes(this.socket!, dataLen);
    }

    return { status, message, data: dataBuffer };
  }

  // --- Public API Methods (same as before, plus authentication checks) ---

  async set<T = any>(
    key: string,
    value: T,
    ttlSeconds: number = 0
  ): Promise<string> {
    const keyBuffer = writeString(key);
    const valueBuffer = writeBytes(Buffer.from(JSON.stringify(value)));
    const ttlBuffer = Buffer.alloc(8);
    ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);

    const payload = Buffer.concat([keyBuffer, valueBuffer, ttlBuffer]);
    const response = await this.sendCommand(CMD_SET, payload);

    if (response.status !== STATUS_OK) {
      throw new Error(`SET failed: ${getStatusString(response.status)}: ${response.message}`);
    }
    return response.message;
  }

  async get<T = any>(key: string): Promise<GetResult<T>> {
    const keyBuffer = writeString(key);
    const payload = keyBuffer;

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

  async collectionCreate(collectionName: string): Promise<string> {
    const payload = writeString(collectionName);
    const response = await this.sendCommand(CMD_COLLECTION_CREATE, payload);
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_CREATE failed: ${getStatusString(response.status)}: ${response.message}`);
    }
    return response.message;
  }

  async collectionDelete(collectionName: string): Promise<string> {
    const payload = writeString(collectionName);
    const response = await this.sendCommand(CMD_COLLECTION_DELETE, payload);
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_DELETE failed: ${getStatusString(response.status)}: ${response.message}`);
    }
    return response.message;
  }

  async collectionList(): Promise<CollectionListResult> {
    const payload = Buffer.alloc(0);
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

  async collectionItemSet<T = any>(
    collectionName: string,
    key: string,
    value: T,
    ttlSeconds: number = 0
  ): Promise<string> {
    const collectionNameBuffer = writeString(collectionName);
    const keyBuffer = writeString(key);
    const valueBuffer = writeBytes(Buffer.from(JSON.stringify(value)));
    const ttlBuffer = Buffer.alloc(8);
    ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);

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
      // Special handling for _system collection: values are directly JSON objects
      // (sanitized by server to not include password hash)
      if (collectionName === "_system" && key.startsWith("user:")) {
        const value = JSON.parse(response.data.toString("utf8")) as T;
        return { found: true, message: response.message, value };
      }
      
      // For all other collections, values are raw JSON bytes.
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
    ); // map<key, value_as_string_or_base64>
    const decodedMap: { [key: string]: T } = {};

    for (const key in rawMap) {
      try {
        // Special handling for _system collection: values are directly JSON objects
        if (collectionName === "_system" && key.startsWith("user:")) {
            decodedMap[key] = JSON.parse(rawMap[key]) as T;
        } else {
            // For all other collections, values are Base64 encoded JSON
            const decodedVal = Buffer.from(rawMap[key], "base64");
            decodedMap[key] = JSON.parse(decodedVal.toString("utf8")) as T;
        }
      } catch (e: any) {
        console.warn(
          `DBClient: Warning - Failed to decode or parse JSON for key '${key}' in collection item list: ${e.message}. Raw: ${rawMap[key]}`
        );
        decodedMap[key] = rawMap[key] as T;
      }
    }
    return { message: response.message, items: decodedMap };
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
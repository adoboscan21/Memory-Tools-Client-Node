import tls from "node:tls";
import net from "node:net";
import fs from "node:fs";
import { Buffer } from "node:buffer";

// --- Protocol Constants (must match internal/protocol/protocol.go) ---
const CMD_SET = 1;
const CMD_GET = 2;
const CMD_COLLECTION_CREATE = 3;
const CMD_COLLECTION_DELETE = 4;
const CMD_COLLECTION_LIST = 5;
const CMD_COLLECTION_ITEM_SET = 6;
const CMD_COLLECTION_ITEM_GET = 7;
const CMD_COLLECTION_ITEM_DELETE = 8;
const CMD_COLLECTION_ITEM_LIST = 9;

const STATUS_OK = 1;
const STATUS_NOT_FOUND = 2;

// Interface for command responses
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

// Writes a length-prefixed string (uint32 length + string bytes)
function writeString(str: string): Buffer {
  // Writes a string prefixed by its length (4 bytes, little-endian).
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(Buffer.byteLength(str, "utf8"), 0);
  return Buffer.concat([lenBuffer, Buffer.from(str, "utf8")]);
}

// Writes a length-prefixed byte array (uint32 length + byte array)
function writeBytes(bytes: Buffer): Buffer {
  // Writes a byte array prefixed by its length (4 bytes, little-endian).
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([lenBuffer, bytes]);
}

// Helper to read N bytes from the socket, handling partial reads
function readNBytes(socket: tls.TLSSocket, n: number): Promise<Buffer> {
  // Reads exactly 'n' bytes from the socket.
  return new Promise((resolve, reject) => {
    const buffer = Buffer.alloc(n);
    let bytesRead = 0;

    const onData = (chunk: Buffer) => {
      // Ensure we don't write more than 'n' bytes or beyond buffer capacity
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
  // Export the class
  private host: string;
  private port: number;
  private serverCertPath: string | null;
  private rejectUnauthorized: boolean;
  private socket: tls.TLSSocket | null;
  private connectingPromise: Promise<tls.TLSSocket> | null;

  constructor(
    host: string,
    port: number,
    serverCertPath: string | null = null,
    rejectUnauthorized: boolean = true
  ) {
    this.host = host;
    this.port = port;
    this.serverCertPath = serverCertPath;
    this.rejectUnauthorized = rejectUnauthorized;
    this.socket = null;
    this.connectingPromise = null;
  }

  async connect(): Promise<tls.TLSSocket> {
    // Explicit return type
    // Establishes a TLS connection to the database server.
    if (this.socket && !this.socket.destroyed) {
      console.log("DBClient: Already connected.");
      return this.socket;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = new Promise((resolve, reject) => {
      let serverCert: Buffer | undefined = undefined;
      if (this.serverCertPath) {
        try {
          serverCert = fs.readFileSync(this.serverCertPath);
        } catch (err: any) {
          // Type 'any' for unknown error structure
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
          // Checks the server's certificate identity.
          // Note: In Node.js >= 15.0.0, checkServerIdentity might not be strictly needed for IP addresses
          // if you're correctly setting 'host' and 'servername' in TLS options.
          // For self-signed CAs, ensure SANs match or pass rejectUnauthorized: false in dev.
          if (
            net.isIP(this.host) &&
            cert.subjectaltname &&
            (cert.subjectaltname.includes(`IP:${this.host}`) ||
              cert.subjectaltname.includes(`DNS:${this.host}`))
          ) {
            return undefined;
          }
          if (
            this.host === "localhost" &&
            cert.subjectaltname &&
            cert.subjectaltname.includes("DNS:localhost")
          ) {
            return undefined;
          }
          if (cert.subject && cert.subject.CN === this.host) {
            return undefined;
          }
          console.warn(
            `DBClient: WARNING - Server certificate identity check failed for host ${
              this.host
            }. CN: ${cert.subject ? cert.subject.CN : "N/A"}, SANs: ${
              cert.subjectaltname || "N/A"
            }`
          );
          return new Error(
            "Certificate identity mismatch (for self-signed, ensure SANs match or relax check)"
          );
        },
      };

      this.socket = tls.connect(options, () => {
        if (this.socket!.authorized || !this.rejectUnauthorized) {
          // Non-null assertion (!)
          resolve(this.socket!); // Non-null assertion (!)
        } else {
          reject(
            new Error(
              `DBClient: TLS connection unauthorized: ${
                this.socket!.authorizationError
              }` // Non-null assertion (!)
            )
          );
        }
      });

      this.socket.on("error", (err: Error) => {
        console.error(`DBClient: Socket error: ${err.message}`);
        reject(err);
        this.socket = null; // Clear socket on error
        this.connectingPromise = null; // Reset promise on failure
      });

      this.socket.on("close", () => {
        console.log("DBClient: Socket connection closed.");
        this.socket = null;
        this.connectingPromise = null; // Reset promise on close
      });
    });
    return this.connectingPromise;
  }

  // Sends a command and reads its response from the server
  private async sendCommand(
    commandType: number,
    payloadBuffer: Buffer
  ): Promise<CommandResponse> {
    // Sends a command to the server and awaits its response.
    if (!this.socket || this.socket.destroyed) {
      await this.connect(); // Reconnect if disconnected
    }

    const commandBuffer = Buffer.concat([
      Buffer.from([commandType]),
      payloadBuffer,
    ]);

    this.socket!.write(commandBuffer); // Non-null assertion (!) as connect() ensures it's not null

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

  // --- Public API Methods ---

  async set<T = any>(
    key: string,
    value: T,
    ttlSeconds: number = 0
  ): Promise<string> {
    // Sets a key-value pair in the database with an optional TTL.
    const keyBuffer = writeString(key);
    const valueBuffer = writeBytes(Buffer.from(JSON.stringify(value)));
    const ttlBuffer = Buffer.alloc(8);
    ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);

    const payload = Buffer.concat([keyBuffer, valueBuffer, ttlBuffer]);
    const response = await this.sendCommand(CMD_SET, payload);

    if (response.status !== STATUS_OK) {
      throw new Error(`SET failed: ${response.message}`);
    }
    return response.message;
  }

  async get<T = any>(key: string): Promise<GetResult<T>> {
    // Retrieves a value by its key from the database.
    const keyBuffer = writeString(key);
    const payload = keyBuffer;

    const response = await this.sendCommand(CMD_GET, payload);

    if (response.status === STATUS_NOT_FOUND) {
      return { found: false, message: response.message, value: null };
    }
    if (response.status !== STATUS_OK) {
      throw new Error(`GET failed: ${response.message}`);
    }

    try {
      return {
        found: true,
        message: response.message,
        value: JSON.parse(response.data.toString("utf8")) as T, // Type assertion
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
    // Creates a new collection.
    const payload = writeString(collectionName);
    const response = await this.sendCommand(CMD_COLLECTION_CREATE, payload);
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_CREATE failed: ${response.message}`);
    }
    return response.message;
  }

  async collectionDelete(collectionName: string): Promise<string> {
    // Deletes an existing collection.
    const payload = writeString(collectionName);
    const response = await this.sendCommand(CMD_COLLECTION_DELETE, payload);
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_DELETE failed: ${response.message}`);
    }
    return response.message;
  }

  async collectionList(): Promise<CollectionListResult> {
    // Lists all available collections.
    const payload = Buffer.alloc(0);
    const response = await this.sendCommand(CMD_COLLECTION_LIST, payload);
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_LIST failed: ${response.message}`);
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
    // Sets an item within a specific collection with an optional TTL.
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
      throw new Error(`COLLECTION_ITEM_SET failed: ${response.message}`);
    }
    return response.message;
  }

  async collectionItemGet<T = any>(
    collectionName: string,
    key: string
  ): Promise<GetResult<T>> {
    // Retrieves an item from a specific collection by its key.
    const collectionNameBuffer = writeString(collectionName);
    const keyBuffer = writeString(key);
    const payload = Buffer.concat([collectionNameBuffer, keyBuffer]);

    const response = await this.sendCommand(CMD_COLLECTION_ITEM_GET, payload);

    if (response.status === STATUS_NOT_FOUND) {
      return { found: false, message: response.message, value: null };
    }
    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_ITEM_GET failed: ${response.message}`);
    }

    try {
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
    // Deletes an item from a specific collection by its key.
    const collectionNameBuffer = writeString(collectionName);
    const keyBuffer = writeString(key);
    const payload = Buffer.concat([collectionNameBuffer, keyBuffer]);

    const response = await this.sendCommand(
      CMD_COLLECTION_ITEM_DELETE,
      payload
    );

    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_ITEM_DELETE failed: ${response.message}`);
    }
    return response.message;
  }

  async collectionItemList<T = any>(
    collectionName: string
  ): Promise<CollectionItemListResult<T>> {
    // Lists all items and their values within a specific collection.
    const payload = writeString(collectionName);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_LIST, payload);

    if (response.status !== STATUS_OK) {
      throw new Error(`COLLECTION_ITEM_LIST failed: ${response.message}`);
    }

    const rawMap: { [key: string]: string } = JSON.parse(
      response.data.toString("utf8")
    ); // map<string, base64_string>
    const decodedMap: { [key: string]: T } = {}; // Use generic type T for values

    for (const key in rawMap) {
      try {
        const decodedVal = Buffer.from(rawMap[key], "base64");
        decodedMap[key] = JSON.parse(decodedVal.toString("utf8")) as T; // Type assertion
      } catch (e: any) {
        console.warn(
          `DBClient: Warning - Failed to Base64 decode or parse JSON for key '${key}' in collection item list: ${e.message}. Raw: ${rawMap[key]}`
        );
        // If JSON parsing fails, we could keep the raw string or handle as error.
        // For now, keeping the raw Base64 string for inspection.
        // If 'T' is expected to always be a JSON object, this might warrant throwing an error.
        decodedMap[key] = rawMap[key] as T; // Coerce to T, but this might break type safety if T is not string
      }
    }
    return { message: response.message, items: decodedMap };
  }

  // Closes the underlying socket connection.
  close(): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
    }
  }
}

// Export the client for use in other modules.
export default MemoryToolsClient;

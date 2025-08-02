import tls from "node:tls";
import net from "node:net";
import fs from "node:fs";
import { Buffer } from "node:buffer";

// --- Protocol Constants (must match internal/protocol/protocol.go) ---
// COMMAND TYPES - Corrected to match Go's iota values
const CMD_SET = 1;
const CMD_GET = 2;
const CMD_COLLECTION_CREATE = 3;
const CMD_COLLECTION_DELETE = 4;
const CMD_COLLECTION_LIST = 5;
const CMD_COLLECTION_INDEX_CREATE = 6;
const CMD_COLLECTION_INDEX_DELETE = 7;
const CMD_COLLECTION_INDEX_LIST = 8;
const CMD_COLLECTION_ITEM_SET = 9;
const CMD_COLLECTION_ITEM_SET_MANY = 10;
const CMD_COLLECTION_ITEM_GET = 11;
const CMD_COLLECTION_ITEM_DELETE = 12;
const CMD_COLLECTION_ITEM_LIST = 13;
const CMD_COLLECTION_QUERY = 14;
const CMD_COLLECTION_ITEM_DELETE_MANY = 15;
const CMD_AUTHENTICATE = 16;

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
    case STATUS_OK:
      return "OK";
    case STATUS_NOT_FOUND:
      return "NOT_FOUND";
    case STATUS_ERROR:
      return "ERROR";
    case STATUS_BAD_COMMAND:
      return "BAD_COMMAND";
    case STATUS_UNAUTHORIZED:
      return "UNAUTHORIZED";
    case STATUS_BAD_REQUEST:
      return "BAD_REQUEST";
    default:
      return "UNKNOWN_STATUS";
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

// Query defines the structure for a collection query command
interface Query {
  filter?: { [key: string]: any };
  orderBy?: OrderByClause[];
  limit?: number;
  offset?: number;
  count?: boolean;
  aggregations?: { [key: string]: Aggregation };
  groupBy?: string[];
  having?: { [key: string]: any };
  distinct?: string;
}

// OrderByClause defines a single ordering criterion
interface OrderByClause {
  field: string;
  direction: "asc" | "desc";
}

// Aggregation defines an aggregation function
interface Aggregation {
  func: "sum" | "avg" | "min" | "max" | "count";
  field: string;
}

// Helper: Writes a length-prefixed string (uint32 LE length + string bytes)
function writeString(str: string): Buffer {
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(Buffer.byteLength(str, "utf8"), 0);
  return Buffer.concat([lenBuffer, Buffer.from(str, "utf8")]);
}

// Helper: Writes a length-prefixed byte array (uint32 LE length + byte array)
function writeBytes(bytes: Buffer): Buffer {
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(bytes.length, 0);
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
        resolve(buffer);
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
   * Establishes a TLS connection and authenticates.
   */
  async connect(): Promise<tls.TLSSocket> {
    if (this.socket && !this.socket.destroyed && this.isAuthenticatedSession) {
      return this.socket;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }
    this.connectingPromise = new Promise(async (resolve, reject) => {
      const options: tls.ConnectionOptions = {
        host: this.host,
        port: this.port,
        rejectUnauthorized: this.rejectUnauthorized,
      };
      if (this.serverCertPath) {
        try {
          options.ca = [fs.readFileSync(this.serverCertPath)];
        } catch (err: any) {
          this.connectingPromise = null;
          return reject(new Error(`Failed to read server certificate: ${err.message}`));
        }
      }
      this.socket = tls.connect(options, async () => {
        if (!this.socket!.authorized && this.rejectUnauthorized) {
          const authError = this.socket!.authorizationError;
          this.socket?.destroy();
          this.connectingPromise = null;
          return reject(new Error(`TLS connection unauthorized: ${authError}`));
        }
        if (this.username && this.password) {
          try {
            await this.performAuthentication(this.username, this.password);
            resolve(this.socket!);
          } catch (authErr: any) {
            this.socket?.destroy();
            this.connectingPromise = null;
            reject(authErr);
          }
        } else {
          this.isAuthenticatedSession = false; // Not authenticated if no credentials are provided
          resolve(this.socket!);
        }
      });
      this.socket.on("error", (err) => {
        this.socket = null;
        this.connectingPromise = null;
        this.isAuthenticatedSession = false;
        this.authenticatedUser = null;
        reject(err);
      });
      this.socket.on("close", () => {
        this.socket = null;
        this.connectingPromise = null;
        this.isAuthenticatedSession = false;
        this.authenticatedUser = null;
      });
    });
    return this.connectingPromise;
  }

  private async readFullResponse(): Promise<CommandResponse> {
    if (!this.socket) throw new Error("Socket is not available.");
    const statusByte = await readNBytes(this.socket, 1);
    const status = statusByte.readUInt8(0);
    const msgLenBuffer = await readNBytes(this.socket, 4);
    const msgLen = msgLenBuffer.readUInt32LE(0);
    const msgBuffer = await readNBytes(this.socket, msgLen);
    const message = msgBuffer.toString("utf8");
    const dataLenBuffer = await readNBytes(this.socket, 4);
    const dataLen = dataLenBuffer.readUInt32LE(0);
    const dataBuffer = await readNBytes(this.socket, dataLen);
    return { status, message, data: dataBuffer };
  }

  private async performAuthentication(username: string, password: string): Promise<string> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Cannot authenticate, socket is not connected.");
    }
    const payload = Buffer.concat([writeString(username), writeString(password)]);
    const commandBuffer = Buffer.concat([Buffer.from([CMD_AUTHENTICATE]), payload]);
    this.socket.write(commandBuffer);
    const { status, message } = await this.readFullResponse();
    if (status === STATUS_OK) {
      this.isAuthenticatedSession = true;
      this.authenticatedUser = username;
      return message;
    } else {
      this.isAuthenticatedSession = false;
      this.authenticatedUser = null;
      throw new Error(`Authentication failed: ${getStatusString(status)}: ${message}`);
    }
  }

  private async sendCommand(commandType: number, payloadBuffer: Buffer): Promise<CommandResponse> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Not connected. Call connect() first.");
    }
    if (commandType !== CMD_AUTHENTICATE && !this.isAuthenticatedSession) {
      throw new Error("Not authenticated. Connect with credentials first.");
    }
    const commandBuffer = Buffer.concat([Buffer.from([commandType]), payloadBuffer]);
    this.socket.write(commandBuffer);
    return this.readFullResponse();
  }

  // --- Public API Methods ---

  async set<T = any>(key: string, value: T, ttlSeconds: number = 0): Promise<string> {
    // FIX: Create buffer first, then write to it.
    const ttlBuffer = Buffer.alloc(8);
    ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);

    const payload = Buffer.concat([
      writeString(key),
      writeBytes(Buffer.from(JSON.stringify(value))),
      ttlBuffer, // Pass the buffer variable
    ]);
    const response = await this.sendCommand(CMD_SET, payload);
    if (response.status !== STATUS_OK) throw new Error(`SET failed: ${getStatusString(response.status)}: ${response.message}`);
    return response.message;
  }

  async get<T = any>(key: string): Promise<GetResult<T>> {
    const response = await this.sendCommand(CMD_GET, writeString(key));
    if (response.status === STATUS_NOT_FOUND) return { found: false, message: response.message, value: null };
    if (response.status !== STATUS_OK) throw new Error(`GET failed: ${getStatusString(response.status)}: ${response.message}`);
    try {
      return { found: true, message: response.message, value: JSON.parse(response.data.toString("utf8")) as T };
    } catch (e) {
      throw new Error("GET failed: Invalid JSON in stored value.");
    }
  }

  async collectionCreate(collectionName: string): Promise<string> {
    const response = await this.sendCommand(CMD_COLLECTION_CREATE, writeString(collectionName));
    if (response.status !== STATUS_OK) throw new Error(`Collection Create failed: ${getStatusString(response.status)}: ${response.message}`);
    return response.message;
  }

  async collectionDelete(collectionName: string): Promise<string> {
    const response = await this.sendCommand(CMD_COLLECTION_DELETE, writeString(collectionName));
    if (response.status !== STATUS_OK) throw new Error(`Collection Delete failed: ${getStatusString(response.status)}: ${response.message}`);
    return response.message;
  }

  async collectionList(): Promise<CollectionListResult> {
    const response = await this.sendCommand(CMD_COLLECTION_LIST, Buffer.alloc(0));
    if (response.status !== STATUS_OK) throw new Error(`Collection List failed: ${getStatusString(response.status)}: ${response.message}`);
    try {
      return { message: response.message, names: JSON.parse(response.data.toString("utf8")) };
    } catch (e) {
      throw new Error("Collection List failed: Invalid JSON response.");
    }
  }

  async collectionIndexCreate(collectionName: string, fieldName: string): Promise<string> {
    const payload = Buffer.concat([writeString(collectionName), writeString(fieldName)]);
    const response = await this.sendCommand(CMD_COLLECTION_INDEX_CREATE, payload);
    if (response.status !== STATUS_OK) throw new Error(`Index Create failed: ${getStatusString(response.status)}: ${response.message}`);
    return response.message;
  }

  async collectionIndexDelete(collectionName: string, fieldName: string): Promise<string> {
    const payload = Buffer.concat([writeString(collectionName), writeString(fieldName)]);
    const response = await this.sendCommand(CMD_COLLECTION_INDEX_DELETE, payload);
    if (response.status !== STATUS_OK) throw new Error(`Index Delete failed: ${getStatusString(response.status)}: ${response.message}`);
    return response.message;
  }

  async collectionIndexList<T = string[]>(collectionName: string): Promise<T> {
    const response = await this.sendCommand(CMD_COLLECTION_INDEX_LIST, writeString(collectionName));
    if (response.status !== STATUS_OK) throw new Error(`Index List failed: ${getStatusString(response.status)}: ${response.message}`);
    try {
      return JSON.parse(response.data.toString("utf8")) as T;
    } catch (e) {
      throw new Error("Index List failed: Invalid JSON response.");
    }
  }

  async collectionItemSet<T = any>(collectionName: string, key: string, value: T, ttlSeconds: number = 0): Promise<string> {
    // FIX: Create buffer first, then write to it.
    const ttlBuffer = Buffer.alloc(8);
    ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);

    const payload = Buffer.concat([
      writeString(collectionName),
      writeString(key),
      writeBytes(Buffer.from(JSON.stringify(value))),
      ttlBuffer, // Pass the buffer variable
    ]);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_SET, payload);
    if (response.status !== STATUS_OK) throw new Error(`Item Set failed: ${getStatusString(response.status)}: ${response.message}`);
    return response.message;
  }

  async collectionItemSetMany<T = any>(collectionName: string, values: T[]): Promise<string> {
    const payload = Buffer.concat([writeString(collectionName), writeBytes(Buffer.from(JSON.stringify(values)))]);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_SET_MANY, payload);
    if (response.status !== STATUS_OK) throw new Error(`Item Set Many failed: ${getStatusString(response.status)}: ${response.message}`);
    return response.message;
  }

  async collectionItemGet<T = any>(collectionName: string, key: string): Promise<GetResult<T>> {
    const payload = Buffer.concat([writeString(collectionName), writeString(key)]);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_GET, payload);
    if (response.status === STATUS_NOT_FOUND) return { found: false, message: response.message, value: null };
    if (response.status !== STATUS_OK) throw new Error(`Item Get failed: ${getStatusString(response.status)}: ${response.message}`);
    try {
      return { found: true, message: response.message, value: JSON.parse(response.data.toString("utf8")) as T };
    } catch (e) {
      throw new Error("Item Get failed: Invalid JSON in stored value.");
    }
  }

  async collectionItemDelete(collectionName: string, key: string): Promise<string> {
    const payload = Buffer.concat([writeString(collectionName), writeString(key)]);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_DELETE, payload);
    if (response.status !== STATUS_OK) throw new Error(`Item Delete failed: ${getStatusString(response.status)}: ${response.message}`);
    return response.message;
  }

  async collectionItemDeleteMany(collectionName: string, keys: string[]): Promise<string> {
    const keysCountBuffer = Buffer.alloc(4);
    keysCountBuffer.writeUInt32LE(keys.length, 0);
    const keysPayload = keys.map(key => writeString(key));
    const payload = Buffer.concat([writeString(collectionName), keysCountBuffer, ...keysPayload]);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_DELETE_MANY, payload);
    if (response.status !== STATUS_OK) throw new Error(`Item Delete Many failed: ${getStatusString(response.status)}: ${response.message}`);
    return response.message;
  }

  async collectionItemList<T = any>(collectionName: string): Promise<CollectionItemListResult<T>> {
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_LIST, writeString(collectionName));
    if (response.status !== STATUS_OK) throw new Error(`Item List failed: ${getStatusString(response.status)}: ${response.message}`);
    const rawMap: { [key: string]: string } = JSON.parse(response.data.toString("utf8"));
    const decodedMap: { [key: string]: T } = {};
    for (const key in rawMap) {
      try {
        if (collectionName === "_system" && key.startsWith("user:")) {
          decodedMap[key] = JSON.parse(rawMap[key]) as T;
        } else {
          const decodedVal = Buffer.from(rawMap[key], "base64");
          decodedMap[key] = JSON.parse(decodedVal.toString("utf8")) as T;
        }
      } catch (e) {
        decodedMap[key] = rawMap[key] as any;
      }
    }
    return { message: response.message, items: decodedMap };
  }

  async collectionQuery<T = any>(collectionName: string, query: Query): Promise<T> {
    const payload = Buffer.concat([writeString(collectionName), writeBytes(Buffer.from(JSON.stringify(query)))]);
    const response = await this.sendCommand(CMD_COLLECTION_QUERY, payload);
    if (response.status !== STATUS_OK) throw new Error(`Query failed: ${getStatusString(response.status)}: ${response.message}`);
    try {
      return JSON.parse(response.data.toString("utf8")) as T;
    } catch (e) {
      throw new Error("Query failed: Invalid JSON response.");
    }
  }

  isSessionAuthenticated(): boolean {
    return this.isAuthenticatedSession;
  }

  getAuthenticatedUsername(): string | null {
    return this.authenticatedUser;
  }

  close(): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
    }
  }
}

export default MemoryToolsClient;
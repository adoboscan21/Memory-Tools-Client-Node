import tls from "node:tls";
import fs from "node:fs";
import { Buffer } from "node:buffer";

// --- Protocol Constants (Synchronized with internal/protocol/protocol.go) ---
// COMMAND TYPES - Only client-facing commands are used in the public API.
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
const CMD_COLLECTION_QUERY = 14;
const CMD_COLLECTION_ITEM_DELETE_MANY = 15;
const CMD_COLLECTION_ITEM_UPDATE = 16;
const CMD_COLLECTION_ITEM_UPDATE_MANY = 17;
const CMD_AUTHENTICATE = 18;
// Administrative commands are not exposed in this client library.

// RESPONSE STATUS CODES
const STATUS_OK = 1;
const STATUS_NOT_FOUND = 2;
const STATUS_ERROR = 3;
const STATUS_BAD_COMMAND = 4;
const STATUS_UNAUTHORIZED = 5;
const STATUS_BAD_REQUEST = 6;

// --- Helper Functions & Interfaces ---

/** Converts a numeric status code to its string representation for better error messages. */
function getStatusString(status: number): string {
  const statuses: { [key: number]: string } = {
    [STATUS_OK]: "OK",
    [STATUS_NOT_FOUND]: "NOT_FOUND",
    [STATUS_ERROR]: "ERROR",
    [STATUS_BAD_COMMAND]: "BAD_COMMAND",
    [STATUS_UNAUTHORIZED]: "UNAUTHORIZED",
    [STATUS_BAD_REQUEST]: "BAD_REQUEST",
  };
  return statuses[status] || "UNKNOWN_STATUS";
}

// --- Type Definitions ---
interface CommandResponse {
  status: number;
  message: string;
  data: Buffer;
}

export interface GetResult<T = any> {
  found: boolean;
  message: string;
  value: T | null;
}

export interface LookupClause {
  from: string;
  localField: string;
  foreignField: string;
  as: string;
}

export interface Query {
  filter?: { [key: string]: any };
  orderBy?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
  count?: boolean;
  aggregations?: {
    [key: string]: {
      func: "sum" | "avg" | "min" | "max" | "count";
      field: string;
    };
  };
  groupBy?: string[];
  having?: { [key: string]: any };
  distinct?: string;
  projection?: string[];
  lookups?: LookupClause[];
}

/** Helper: Writes a length-prefixed string (uint32 LE length + string bytes). */
function writeString(str: string): Buffer {
  const strBuffer = Buffer.from(str, "utf8");
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(strBuffer.length, 0);
  return Buffer.concat([lenBuffer, strBuffer]);
}

/** Helper: Writes a length-prefixed byte array (uint32 LE length + byte array). */
function writeBytes(bytes: Buffer): Buffer {
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([lenBuffer, bytes]);
}

// --- Main DB Client Class ---

export class MemoryToolsClient {
  private host: string;
  private port: number;
  private username: string | null;
  private password: string | null;
  private serverCertPath: string | null;
  private rejectUnauthorized: boolean;

  private socket: tls.TLSSocket | null = null;
  private connectingPromise: Promise<tls.TLSSocket> | null = null;
  public isAuthenticatedSession: boolean = false;
  public authenticatedUser: string | null = null;

  private responseBuffer = Buffer.alloc(0);
  private responseWaiter: ((value: CommandResponse) => void) | null = null;

  constructor(
    host: string,
    port: number,
    username?: string,
    password?: string,
    serverCertPath?: string,
    rejectUnauthorized: boolean = true
  ) {
    this.host = host;
    this.port = port;
    this.username = username || null;
    this.password = password || null;
    this.serverCertPath = serverCertPath || null;
    this.rejectUnauthorized = rejectUnauthorized;
  }

  /**
   * Establishes a TLS connection and authenticates if credentials are provided.
   * Handles reconnection logic automatically.
   */
  public async connect(): Promise<tls.TLSSocket> {
    if (this.socket && !this.socket.destroyed) {
      return this.socket;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = new Promise((resolve, reject) => {
      const options: tls.ConnectionOptions = {
        host: this.host,
        port: this.port,
        rejectUnauthorized: this.rejectUnauthorized,
      };
      if (this.serverCertPath) {
        try {
          options.ca = [fs.readFileSync(this.serverCertPath)];
        } catch (err: any) {
          return reject(
            new Error(`Failed to read server certificate: ${err.message}`)
          );
        }
      }

      const socket = tls.connect(options, async () => {
        if (!socket.authorized && this.rejectUnauthorized) {
          return reject(
            new Error(
              `TLS connection unauthorized: ${socket.authorizationError}`
            )
          );
        }

        this.socket = socket;
        this.setupSocketListeners();

        try {
          if (this.username && this.password) {
            await this.performAuthentication(this.username, this.password);
          }
          resolve(this.socket);
        } catch (authErr) {
          reject(authErr);
        } finally {
          this.connectingPromise = null;
        }
      });

      socket.on("error", (err) => this.cleanup(reject, err));
      socket.on("close", () => this.cleanup());
    });

    return this.connectingPromise;
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;
    this.socket.on("data", (chunk) => {
      this.responseBuffer = Buffer.concat([this.responseBuffer, chunk]);
      this.tryProcessResponse();
    });
  }

  // ====================================================================
  // ⬇️⬇️⬇️ INICIO DE LA SECCIÓN CORREGIDA ⬇️⬇️⬇️
  // ====================================================================
  private tryProcessResponse(): void {
    // If no promise is waiting for a response, do nothing.
    if (!this.responseWaiter) return;

    // Loop to process multiple complete responses that might be in the buffer
    while (true) {
      // --- Step 1: Check for the minimum header (status + msgLen) ---
      const MIN_HEADER_SIZE = 5; // 1 byte for status, 4 for msgLen
      if (this.responseBuffer.length < MIN_HEADER_SIZE) {
        // Not enough data for the basic header, exit the loop and wait for more.
        return;
      }

      const msgLen = this.responseBuffer.readUInt32LE(1);

      // --- Step 2: Check for the full message and the data length field ---
      const REQUIRED_FOR_DATA_LEN = MIN_HEADER_SIZE + msgLen + 4; // Header + Message + dataLen (4 bytes)
      if (this.responseBuffer.length < REQUIRED_FOR_DATA_LEN) {
        // The full message or the dataLen field hasn't arrived yet, exit.
        return;
      }

      const dataLen = this.responseBuffer.readUInt32LE(
        MIN_HEADER_SIZE + msgLen
      );

      // --- Step 3: Check for the complete packet (including the data itself) ---
      const totalPacketLength = REQUIRED_FOR_DATA_LEN + dataLen;
      if (this.responseBuffer.length < totalPacketLength) {
        // The full data payload hasn't arrived yet, exit.
        return;
      }

      // --- If we get here, we have a complete packet ready to process ---
      const status = this.responseBuffer.readUInt8(0);
      const message = this.responseBuffer.toString(
        "utf8",
        MIN_HEADER_SIZE,
        MIN_HEADER_SIZE + msgLen
      );
      const data = this.responseBuffer.subarray(
        REQUIRED_FOR_DATA_LEN,
        totalPacketLength
      );

      const response: CommandResponse = { status, message, data };

      // Consume the packet from the buffer, leaving the rest for the next iteration.
      this.responseBuffer = this.responseBuffer.subarray(totalPacketLength);

      // Resolve the promise that was waiting for this response.
      const waiter = this.responseWaiter;
      this.responseWaiter = null;
      waiter(response);

      // If nobody is waiting for the next response, stop the loop.
      if (!this.responseWaiter) {
        return;
      }
    }
  }
  // ====================================================================
  // ⬆️⬆️⬆️ FIN DE LA SECCIÓN CORREGIDA ⬆️⬆️⬆️
  // ====================================================================

  private async performAuthentication(
    username: string,
    password: string
  ): Promise<string> {
    const payload = Buffer.concat([
      writeString(username),
      writeString(password),
    ]);
    this.socket!.write(
      Buffer.concat([Buffer.from([CMD_AUTHENTICATE]), payload])
    );

    const { status, message } = await this.waitForResponse();
    if (status === STATUS_OK) {
      this.isAuthenticatedSession = true;
      this.authenticatedUser = username;
      return message;
    } else {
      this.cleanup();
      throw new Error(
        `Authentication failed: ${getStatusString(status)}: ${message}`
      );
    }
  }

  private waitForResponse(): Promise<CommandResponse> {
    return new Promise((resolve) => {
      this.responseWaiter = resolve;
      this.tryProcessResponse(); // Check if the response is already in the buffer
    });
  }

  private async sendCommand(
    commandType: number,
    payloadBuffer: Buffer
  ): Promise<CommandResponse> {
    await this.connect(); // Ensure we are connected
    if (!this.socket) throw new Error("Not connected.");
    if (commandType !== CMD_AUTHENTICATE && !this.isAuthenticatedSession) {
      throw new Error("Not authenticated. Connect with credentials first.");
    }

    const commandBuffer = Buffer.concat([
      Buffer.from([commandType]),
      payloadBuffer,
    ]);
    this.socket.write(commandBuffer);
    return this.waitForResponse();
  }

  private cleanup(reject?: (reason?: any) => void, err?: Error): void {
    if (this.connectingPromise && reject && err) {
      this.connectingPromise = null;
      reject(err);
    }
    this.socket?.destroy();
    this.socket = null;
    this.connectingPromise = null;
    this.isAuthenticatedSession = false;
    this.authenticatedUser = null;
    this.responseBuffer = Buffer.alloc(0);
  }

  /** Closes the connection to the server. */
  public close(): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
    }
    this.cleanup();
  }

  // --- Public Client API (el resto del código no cambia) ---

  /** Ensures a collection with the given name exists. */
  public async collectionCreate(collectionName: string): Promise<string> {
    const response = await this.sendCommand(
      CMD_COLLECTION_CREATE,
      writeString(collectionName)
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Collection Create failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Deletes an entire collection and all of its items. */
  public async collectionDelete(collectionName: string): Promise<string> {
    const response = await this.sendCommand(
      CMD_COLLECTION_DELETE,
      writeString(collectionName)
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Collection Delete failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Lists the names of all collections the current user can access. */
  public async collectionList(): Promise<string[]> {
    const response = await this.sendCommand(
      CMD_COLLECTION_LIST,
      Buffer.alloc(0)
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Collection List failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return JSON.parse(response.data.toString("utf8"));
  }

  /** Creates an index on a field to speed up queries. */
  public async collectionIndexCreate(
    collectionName: string,
    fieldName: string
  ): Promise<string> {
    const payload = Buffer.concat([
      writeString(collectionName),
      writeString(fieldName),
    ]);
    const response = await this.sendCommand(
      CMD_COLLECTION_INDEX_CREATE,
      payload
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Index Create failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Deletes an index from a field. */
  public async collectionIndexDelete(
    collectionName: string,
    fieldName: string
  ): Promise<string> {
    const payload = Buffer.concat([
      writeString(collectionName),
      writeString(fieldName),
    ]);
    const response = await this.sendCommand(
      CMD_COLLECTION_INDEX_DELETE,
      payload
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Index Delete failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Returns a list of indexed fields for a collection. */
  public async collectionIndexList(collectionName: string): Promise<string[]> {
    const response = await this.sendCommand(
      CMD_COLLECTION_INDEX_LIST,
      writeString(collectionName)
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Index List failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return JSON.parse(response.data.toString("utf8"));
  }

  /** Sets an item (JSON document) within a collection. */
  public async collectionItemSet<T = any>(
    collectionName: string,
    key: string,
    value: T,
    ttlSeconds: number = 0
  ): Promise<string> {
    const ttlBuffer = Buffer.alloc(8);
    ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);
    const payload = Buffer.concat([
      writeString(collectionName),
      writeString(key),
      writeBytes(Buffer.from(JSON.stringify(value))),
      ttlBuffer,
    ]);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_SET, payload);
    if (response.status !== STATUS_OK)
      throw new Error(
        `Item Set failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Sets multiple items from a list of dictionaries in a single batch operation. */
  public async collectionItemSetMany<T extends { _id?: string }>(
    collectionName: string,
    items: T[]
  ): Promise<string> {
    const payload = Buffer.concat([
      writeString(collectionName),
      writeBytes(Buffer.from(JSON.stringify(items))),
    ]);
    const response = await this.sendCommand(
      CMD_COLLECTION_ITEM_SET_MANY,
      payload
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Item Set Many failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Partially updates an existing item. Only the fields in `patchValue` will be added or overwritten. */
  public async collectionItemUpdate<T = any>(
    collectionName: string,
    key: string,
    patchValue: Partial<T>
  ): Promise<string> {
    const payload = Buffer.concat([
      writeString(collectionName),
      writeString(key),
      writeBytes(Buffer.from(JSON.stringify(patchValue))),
    ]);
    const response = await this.sendCommand(
      CMD_COLLECTION_ITEM_UPDATE,
      payload
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Item Update failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Partially updates multiple items in a single batch. `items` must be `[{'_id': 'key1', 'patch': {...}}, ...]`. */
  public async collectionItemUpdateMany<T = any>(
    collectionName: string,
    items: { _id: string; patch: Partial<T> }[]
  ): Promise<string> {
    const payload = Buffer.concat([
      writeString(collectionName),
      writeBytes(Buffer.from(JSON.stringify(items))),
    ]);
    const response = await this.sendCommand(
      CMD_COLLECTION_ITEM_UPDATE_MANY,
      payload
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Item Update Many failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Retrieves a single item from a collection. */
  public async collectionItemGet<T = any>(
    collectionName: string,
    key: string
  ): Promise<GetResult<T>> {
    const payload = Buffer.concat([
      writeString(collectionName),
      writeString(key),
    ]);
    const response = await this.sendCommand(CMD_COLLECTION_ITEM_GET, payload);
    if (response.status === STATUS_NOT_FOUND)
      return { found: false, message: response.message, value: null };
    if (response.status !== STATUS_OK)
      throw new Error(
        `Item Get failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return {
      found: true,
      message: response.message,
      value: JSON.parse(response.data.toString("utf8")) as T,
    };
  }

  /** Deletes a single item from a collection by its key. */
  public async collectionItemDelete(
    collectionName: string,
    key: string
  ): Promise<string> {
    const payload = Buffer.concat([
      writeString(collectionName),
      writeString(key),
    ]);
    const response = await this.sendCommand(
      CMD_COLLECTION_ITEM_DELETE,
      payload
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Item Delete failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Deletes multiple items from a collection by their keys in a single batch. */
  public async collectionItemDeleteMany(
    collectionName: string,
    keys: string[]
  ): Promise<string> {
    const keysCountBuffer = Buffer.alloc(4);
    keysCountBuffer.writeUInt32LE(keys.length, 0);
    const keysPayload = keys.map((key) => writeString(key));
    const payload = Buffer.concat([
      writeString(collectionName),
      keysCountBuffer,
      ...keysPayload,
    ]);
    const response = await this.sendCommand(
      CMD_COLLECTION_ITEM_DELETE_MANY,
      payload
    );
    if (response.status !== STATUS_OK)
      throw new Error(
        `Item Delete Many failed: ${getStatusString(response.status)}: ${
          response.message
        }`
      );
    return response.message;
  }

  /** Executes a complex query on a collection. */
  public async collectionQuery<T = any>(
    collectionName: string,
    query: Query
  ): Promise<T> {
    const payload = Buffer.concat([
      writeString(collectionName),
      writeBytes(Buffer.from(JSON.stringify(query))),
    ]);
    const response = await this.sendCommand(CMD_COLLECTION_QUERY, payload);
    if (response.status !== STATUS_OK)
      throw new Error(
        `Query failed: ${getStatusString(response.status)}: ${response.message}`
      );
    return JSON.parse(response.data.toString("utf8")) as T;
  }
}

export default MemoryToolsClient;

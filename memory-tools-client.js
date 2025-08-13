var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import tls from "node:tls";
import fs from "node:fs";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto"; // <-- Imported for UUID generation
// --- Protocol Constants (Synchronized with Python client and Go server) ---
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
// NEW TRANSACTION COMMANDS
const CMD_BEGIN = 25;
const CMD_COMMIT = 26;
const CMD_ROLLBACK = 27;
// --- Server Response Statuses ---
const STATUS_OK = 1;
const STATUS_NOT_FOUND = 2;
const STATUS_ERROR = 3;
const STATUS_BAD_COMMAND = 4;
const STATUS_UNAUTHORIZED = 5;
const STATUS_BAD_REQUEST = 6;
// --- Helper Functions, Interfaces & Type Definitions ---
/** Converts a numeric status code to its string representation. */
function getStatusString(status) {
    const statuses = {
        [STATUS_OK]: "OK",
        [STATUS_NOT_FOUND]: "NOT_FOUND",
        [STATUS_ERROR]: "ERROR",
        [STATUS_BAD_COMMAND]: "BAD_COMMAND",
        [STATUS_UNAUTHORIZED]: "UNAUTHORIZED",
        [STATUS_BAD_REQUEST]: "BAD_REQUEST",
    };
    return statuses[status] || "UNKNOWN_STATUS";
}
/** Helper: Writes a length-prefixed string (uint32 LE length + string bytes). */
function writeString(str) {
    const strBuffer = Buffer.from(str, "utf8");
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(strBuffer.length, 0);
    return Buffer.concat([lenBuffer, strBuffer]);
}
/** Helper: Writes a length-prefixed byte array (uint32 LE length + byte array). */
function writeBytes(bytes) {
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([lenBuffer, bytes]);
}
// --- Main DB Client Class ---
export class MemoryToolsClient {
    constructor(host, port, username, password, serverCertPath, rejectUnauthorized = true) {
        this.socket = null;
        this.connectingPromise = null;
        this.isAuthenticatedSession = false;
        this.authenticatedUser = null;
        this.responseBuffer = Buffer.alloc(0);
        this.responseWaiter = null;
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
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.socket && !this.socket.destroyed) {
                return this.socket;
            }
            if (this.connectingPromise) {
                return this.connectingPromise;
            }
            this.connectingPromise = new Promise((resolve, reject) => {
                const options = {
                    host: this.host,
                    port: this.port,
                    rejectUnauthorized: this.rejectUnauthorized,
                };
                if (this.serverCertPath) {
                    try {
                        options.ca = [fs.readFileSync(this.serverCertPath)];
                    }
                    catch (err) {
                        return reject(new Error(`Failed to read server certificate: ${err.message}`));
                    }
                }
                const socket = tls.connect(options, () => __awaiter(this, void 0, void 0, function* () {
                    if (!socket.authorized && this.rejectUnauthorized) {
                        return reject(new Error(`TLS connection unauthorized: ${socket.authorizationError}`));
                    }
                    this.socket = socket;
                    this.setupSocketListeners();
                    try {
                        if (this.username && this.password) {
                            yield this.performAuthentication(this.username, this.password);
                        }
                        resolve(this.socket);
                    }
                    catch (authErr) {
                        reject(authErr);
                    }
                    finally {
                        this.connectingPromise = null;
                    }
                }));
                socket.on("error", (err) => this.cleanup(reject, err));
                socket.on("close", () => this.cleanup());
            });
            return this.connectingPromise;
        });
    }
    setupSocketListeners() {
        if (!this.socket)
            return;
        this.socket.on("data", (chunk) => {
            this.responseBuffer = Buffer.concat([this.responseBuffer, chunk]);
            this.tryProcessResponse();
        });
    }
    tryProcessResponse() {
        if (!this.responseWaiter)
            return;
        while (true) {
            const MIN_HEADER_SIZE = 5; // 1 byte status, 4 bytes msgLen
            if (this.responseBuffer.length < MIN_HEADER_SIZE)
                return;
            const msgLen = this.responseBuffer.readUInt32LE(1);
            const REQUIRED_FOR_DATA_LEN = MIN_HEADER_SIZE + msgLen + 4;
            if (this.responseBuffer.length < REQUIRED_FOR_DATA_LEN)
                return;
            const dataLen = this.responseBuffer.readUInt32LE(MIN_HEADER_SIZE + msgLen);
            const totalPacketLength = REQUIRED_FOR_DATA_LEN + dataLen;
            if (this.responseBuffer.length < totalPacketLength)
                return;
            const status = this.responseBuffer.readUInt8(0);
            const message = this.responseBuffer.toString("utf8", MIN_HEADER_SIZE, MIN_HEADER_SIZE + msgLen);
            const data = this.responseBuffer.subarray(REQUIRED_FOR_DATA_LEN, totalPacketLength);
            const response = { status, message, data };
            this.responseBuffer = this.responseBuffer.subarray(totalPacketLength);
            const waiter = this.responseWaiter;
            this.responseWaiter = null;
            waiter(response);
            if (!this.responseWaiter)
                return;
        }
    }
    performAuthentication(username, password) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([
                writeString(username),
                writeString(password),
            ]);
            this.socket.write(Buffer.concat([Buffer.from([CMD_AUTHENTICATE]), payload]));
            const { status, message } = yield this.waitForResponse();
            if (status === STATUS_OK) {
                this.isAuthenticatedSession = true;
                this.authenticatedUser = username;
                return message;
            }
            else {
                this.cleanup();
                throw new Error(`Authentication failed: ${getStatusString(status)}: ${message}`);
            }
        });
    }
    waitForResponse() {
        return new Promise((resolve) => {
            this.responseWaiter = resolve;
            this.tryProcessResponse(); // Check if the response is already in the buffer
        });
    }
    sendCommand(commandType, payloadBuffer) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.connect(); // Ensure we are connected
            if (!this.socket)
                throw new Error("Not connected.");
            if (commandType !== CMD_AUTHENTICATE && !this.isAuthenticatedSession) {
                throw new Error("Not authenticated. Connect with credentials first.");
            }
            const commandBuffer = Buffer.concat([
                Buffer.from([commandType]),
                payloadBuffer,
            ]);
            this.socket.write(commandBuffer);
            return this.waitForResponse();
        });
    }
    cleanup(reject, err) {
        var _a;
        if (this.connectingPromise && reject && err) {
            this.connectingPromise = null;
            reject(err);
        }
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.destroy();
        this.socket = null;
        this.connectingPromise = null;
        this.isAuthenticatedSession = false;
        this.authenticatedUser = null;
        this.responseBuffer = Buffer.alloc(0);
    }
    /** Closes the connection to the server. */
    close() {
        if (this.socket && !this.socket.destroyed) {
            this.socket.end();
        }
        this.cleanup();
    }
    // --- Public Client API ---
    /**
     * Starts a new transaction.
     * All subsequent commands will be part of this transaction until `commit` or `rollback` is called.
     */
    begin() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_BEGIN, Buffer.alloc(0));
            if (response.status !== STATUS_OK) {
                throw new Error(`Begin failed: ${getStatusString(response.status)}: ${response.message}`);
            }
            return response.message;
        });
    }
    /**
     * Commits the current active transaction, making all its changes permanent.
     */
    commit() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COMMIT, Buffer.alloc(0));
            if (response.status !== STATUS_OK) {
                throw new Error(`Commit failed: ${getStatusString(response.status)}: ${response.message}`);
            }
            return response.message;
        });
    }
    /**
     * Rolls back the current active transaction, discarding all its changes.
     */
    rollback() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_ROLLBACK, Buffer.alloc(0));
            if (response.status !== STATUS_OK) {
                throw new Error(`Rollback failed: ${getStatusString(response.status)}: ${response.message}`);
            }
            return response.message;
        });
    }
    /** Creates a new collection. */
    collectionCreate(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COLLECTION_CREATE, writeString(collectionName));
            if (response.status !== STATUS_OK)
                throw new Error(`Collection Create failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /** Deletes an entire collection and all of its items. */
    collectionDelete(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COLLECTION_DELETE, writeString(collectionName));
            if (response.status !== STATUS_OK)
                throw new Error(`Collection Delete failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /** Lists the names of all collections the current user can access. */
    collectionList() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COLLECTION_LIST, Buffer.alloc(0));
            if (response.status !== STATUS_OK)
                throw new Error(`Collection List failed: ${getStatusString(response.status)}: ${response.message}`);
            return JSON.parse(response.data.toString("utf8"));
        });
    }
    /** Creates an index on a field to speed up queries. */
    collectionIndexCreate(collectionName, fieldName) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([
                writeString(collectionName),
                writeString(fieldName),
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_INDEX_CREATE, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Index Create failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /** Deletes an index from a field. */
    collectionIndexDelete(collectionName, fieldName) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([
                writeString(collectionName),
                writeString(fieldName),
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_INDEX_DELETE, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Index Delete failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /** Returns a list of indexed fields for a collection. */
    collectionIndexList(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COLLECTION_INDEX_LIST, writeString(collectionName));
            if (response.status !== STATUS_OK)
                throw new Error(`Index List failed: ${getStatusString(response.status)}: ${response.message}`);
            return JSON.parse(response.data.toString("utf8"));
        });
    }
    /**
     * Sets an item (JSON document) within a collection.
     * If `key` is not provided, a UUID will be generated, and the `_id` field will be set on the value object.
     *
     * @param collectionName The name of the collection.
     * @param value The document to store.
     * @param key (Optional) The unique key for the item. If not provided, a UUID is generated.
     * @param ttlSeconds (Optional) Time-to-live in seconds for the item. Defaults to 0 (no expiry).
     * @returns A confirmation message from the server.
     */
    collectionItemSet(collectionName_1, value_1, key_1) {
        return __awaiter(this, arguments, void 0, function* (collectionName, value, key, ttlSeconds = 0) {
            const itemKey = key || randomUUID();
            value._id = itemKey; // Ensure the document itself contains the _id
            const ttlBuffer = Buffer.alloc(8);
            ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);
            const payload = Buffer.concat([
                writeString(collectionName),
                writeString(itemKey),
                writeBytes(Buffer.from(JSON.stringify(value))),
                ttlBuffer,
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_SET, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Set failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /**
     * Sets multiple items in a single batch operation. Assigns a UUID to any item that does not have an `_id` field.
     *
     * @param collectionName The name of the collection.
     * @param items An array of documents to store.
     * @returns A confirmation message from the server.
     */
    collectionItemSetMany(collectionName, items) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const item of items) {
                if (!item._id) {
                    item._id = randomUUID();
                }
            }
            const payload = Buffer.concat([
                writeString(collectionName),
                writeBytes(Buffer.from(JSON.stringify(items))),
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_SET_MANY, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Set Many failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /** Partially updates an existing item. Only the fields in `patchValue` will be added or overwritten. */
    collectionItemUpdate(collectionName, key, patchValue) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([
                writeString(collectionName),
                writeString(key),
                writeBytes(Buffer.from(JSON.stringify(patchValue))),
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_UPDATE, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Update failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /** Partially updates multiple items in a single batch. `items` must be `[{'_id': 'key1', 'patch': {...}}, ...]`. */
    collectionItemUpdateMany(collectionName, items) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([
                writeString(collectionName),
                writeBytes(Buffer.from(JSON.stringify(items))),
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_UPDATE_MANY, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Update Many failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /** Retrieves a single item from a collection. */
    collectionItemGet(collectionName, key) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([
                writeString(collectionName),
                writeString(key),
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_GET, payload);
            if (response.status === STATUS_NOT_FOUND)
                return { found: false, message: response.message, value: null };
            if (response.status !== STATUS_OK)
                throw new Error(`Item Get failed: ${getStatusString(response.status)}: ${response.message}`);
            return {
                found: true,
                message: response.message,
                value: JSON.parse(response.data.toString("utf8")),
            };
        });
    }
    /** Deletes a single item from a collection by its key. */
    collectionItemDelete(collectionName, key) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([
                writeString(collectionName),
                writeString(key),
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_DELETE, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Delete failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /** Deletes multiple items from a collection by their keys in a single batch. */
    collectionItemDeleteMany(collectionName, keys) {
        return __awaiter(this, void 0, void 0, function* () {
            const keysCountBuffer = Buffer.alloc(4);
            keysCountBuffer.writeUInt32LE(keys.length, 0);
            const keysPayload = keys.map((key) => writeString(key));
            const payload = Buffer.concat([
                writeString(collectionName),
                keysCountBuffer,
                ...keysPayload,
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_DELETE_MANY, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Delete Many failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    /** Executes a complex query on a collection. */
    collectionQuery(collectionName, query) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([
                writeString(collectionName),
                writeBytes(Buffer.from(JSON.stringify(query))),
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_QUERY, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Query failed: ${getStatusString(response.status)}: ${response.message}`);
            return JSON.parse(response.data.toString("utf8"));
        });
    }
}
export default MemoryToolsClient;

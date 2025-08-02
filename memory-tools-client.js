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
function getStatusString(status) {
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
// Helper: Writes a length-prefixed string (uint32 LE length + string bytes)
function writeString(str) {
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(Buffer.byteLength(str, "utf8"), 0);
    return Buffer.concat([lenBuffer, Buffer.from(str, "utf8")]);
}
// Helper: Writes a length-prefixed byte array (uint32 LE length + byte array)
function writeBytes(bytes) {
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([lenBuffer, bytes]);
}
// Helper to read N bytes from the socket, handling partial reads
function readNBytes(socket, n) {
    return new Promise((resolve, reject) => {
        if (n === 0) {
            return resolve(Buffer.alloc(0));
        }
        const buffer = Buffer.alloc(n);
        let bytesRead = 0;
        const onData = (chunk) => {
            const bytesToCopy = Math.min(chunk.length, n - bytesRead);
            chunk.copy(buffer, bytesRead, 0, bytesToCopy);
            bytesRead += bytesToCopy;
            if (bytesRead >= n) {
                socket.removeListener("data", onData);
                socket.removeListener("error", onError);
                resolve(buffer);
            }
        };
        const onError = (err) => {
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
    constructor(host, port, username = null, password = null, serverCertPath = null, rejectUnauthorized = true) {
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
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.socket && !this.socket.destroyed && this.isAuthenticatedSession) {
                return this.socket;
            }
            if (this.connectingPromise) {
                return this.connectingPromise;
            }
            this.connectingPromise = new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
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
                        this.connectingPromise = null;
                        return reject(new Error(`Failed to read server certificate: ${err.message}`));
                    }
                }
                this.socket = tls.connect(options, () => __awaiter(this, void 0, void 0, function* () {
                    var _a, _b;
                    if (!this.socket.authorized && this.rejectUnauthorized) {
                        const authError = this.socket.authorizationError;
                        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.destroy();
                        this.connectingPromise = null;
                        return reject(new Error(`TLS connection unauthorized: ${authError}`));
                    }
                    if (this.username && this.password) {
                        try {
                            yield this.performAuthentication(this.username, this.password);
                            resolve(this.socket);
                        }
                        catch (authErr) {
                            (_b = this.socket) === null || _b === void 0 ? void 0 : _b.destroy();
                            this.connectingPromise = null;
                            reject(authErr);
                        }
                    }
                    else {
                        this.isAuthenticatedSession = false; // Not authenticated if no credentials are provided
                        resolve(this.socket);
                    }
                }));
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
            }));
            return this.connectingPromise;
        });
    }
    readFullResponse() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.socket)
                throw new Error("Socket is not available.");
            const statusByte = yield readNBytes(this.socket, 1);
            const status = statusByte.readUInt8(0);
            const msgLenBuffer = yield readNBytes(this.socket, 4);
            const msgLen = msgLenBuffer.readUInt32LE(0);
            const msgBuffer = yield readNBytes(this.socket, msgLen);
            const message = msgBuffer.toString("utf8");
            const dataLenBuffer = yield readNBytes(this.socket, 4);
            const dataLen = dataLenBuffer.readUInt32LE(0);
            const dataBuffer = yield readNBytes(this.socket, dataLen);
            return { status, message, data: dataBuffer };
        });
    }
    performAuthentication(username, password) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.socket || this.socket.destroyed) {
                throw new Error("Cannot authenticate, socket is not connected.");
            }
            const payload = Buffer.concat([writeString(username), writeString(password)]);
            const commandBuffer = Buffer.concat([Buffer.from([CMD_AUTHENTICATE]), payload]);
            this.socket.write(commandBuffer);
            const { status, message } = yield this.readFullResponse();
            if (status === STATUS_OK) {
                this.isAuthenticatedSession = true;
                this.authenticatedUser = username;
                return message;
            }
            else {
                this.isAuthenticatedSession = false;
                this.authenticatedUser = null;
                throw new Error(`Authentication failed: ${getStatusString(status)}: ${message}`);
            }
        });
    }
    sendCommand(commandType, payloadBuffer) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.socket || this.socket.destroyed) {
                throw new Error("Not connected. Call connect() first.");
            }
            if (commandType !== CMD_AUTHENTICATE && !this.isAuthenticatedSession) {
                throw new Error("Not authenticated. Connect with credentials first.");
            }
            const commandBuffer = Buffer.concat([Buffer.from([commandType]), payloadBuffer]);
            this.socket.write(commandBuffer);
            return this.readFullResponse();
        });
    }
    // --- Public API Methods ---
    set(key_1, value_1) {
        return __awaiter(this, arguments, void 0, function* (key, value, ttlSeconds = 0) {
            // FIX: Create buffer first, then write to it.
            const ttlBuffer = Buffer.alloc(8);
            ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);
            const payload = Buffer.concat([
                writeString(key),
                writeBytes(Buffer.from(JSON.stringify(value))),
                ttlBuffer, // Pass the buffer variable
            ]);
            const response = yield this.sendCommand(CMD_SET, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`SET failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    get(key) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_GET, writeString(key));
            if (response.status === STATUS_NOT_FOUND)
                return { found: false, message: response.message, value: null };
            if (response.status !== STATUS_OK)
                throw new Error(`GET failed: ${getStatusString(response.status)}: ${response.message}`);
            try {
                return { found: true, message: response.message, value: JSON.parse(response.data.toString("utf8")) };
            }
            catch (e) {
                throw new Error("GET failed: Invalid JSON in stored value.");
            }
        });
    }
    collectionCreate(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COLLECTION_CREATE, writeString(collectionName));
            if (response.status !== STATUS_OK)
                throw new Error(`Collection Create failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    collectionDelete(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COLLECTION_DELETE, writeString(collectionName));
            if (response.status !== STATUS_OK)
                throw new Error(`Collection Delete failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    collectionList() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COLLECTION_LIST, Buffer.alloc(0));
            if (response.status !== STATUS_OK)
                throw new Error(`Collection List failed: ${getStatusString(response.status)}: ${response.message}`);
            try {
                return { message: response.message, names: JSON.parse(response.data.toString("utf8")) };
            }
            catch (e) {
                throw new Error("Collection List failed: Invalid JSON response.");
            }
        });
    }
    collectionIndexCreate(collectionName, fieldName) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([writeString(collectionName), writeString(fieldName)]);
            const response = yield this.sendCommand(CMD_COLLECTION_INDEX_CREATE, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Index Create failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    collectionIndexDelete(collectionName, fieldName) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([writeString(collectionName), writeString(fieldName)]);
            const response = yield this.sendCommand(CMD_COLLECTION_INDEX_DELETE, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Index Delete failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    collectionIndexList(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COLLECTION_INDEX_LIST, writeString(collectionName));
            if (response.status !== STATUS_OK)
                throw new Error(`Index List failed: ${getStatusString(response.status)}: ${response.message}`);
            try {
                return JSON.parse(response.data.toString("utf8"));
            }
            catch (e) {
                throw new Error("Index List failed: Invalid JSON response.");
            }
        });
    }
    collectionItemSet(collectionName_1, key_1, value_1) {
        return __awaiter(this, arguments, void 0, function* (collectionName, key, value, ttlSeconds = 0) {
            // FIX: Create buffer first, then write to it.
            const ttlBuffer = Buffer.alloc(8);
            ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);
            const payload = Buffer.concat([
                writeString(collectionName),
                writeString(key),
                writeBytes(Buffer.from(JSON.stringify(value))),
                ttlBuffer, // Pass the buffer variable
            ]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_SET, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Set failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    collectionItemSetMany(collectionName, values) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([writeString(collectionName), writeBytes(Buffer.from(JSON.stringify(values)))]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_SET_MANY, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Set Many failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    collectionItemGet(collectionName, key) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([writeString(collectionName), writeString(key)]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_GET, payload);
            if (response.status === STATUS_NOT_FOUND)
                return { found: false, message: response.message, value: null };
            if (response.status !== STATUS_OK)
                throw new Error(`Item Get failed: ${getStatusString(response.status)}: ${response.message}`);
            try {
                return { found: true, message: response.message, value: JSON.parse(response.data.toString("utf8")) };
            }
            catch (e) {
                throw new Error("Item Get failed: Invalid JSON in stored value.");
            }
        });
    }
    collectionItemDelete(collectionName, key) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([writeString(collectionName), writeString(key)]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_DELETE, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Delete failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    collectionItemDeleteMany(collectionName, keys) {
        return __awaiter(this, void 0, void 0, function* () {
            const keysCountBuffer = Buffer.alloc(4);
            keysCountBuffer.writeUInt32LE(keys.length, 0);
            const keysPayload = keys.map(key => writeString(key));
            const payload = Buffer.concat([writeString(collectionName), keysCountBuffer, ...keysPayload]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_DELETE_MANY, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Item Delete Many failed: ${getStatusString(response.status)}: ${response.message}`);
            return response.message;
        });
    }
    collectionItemList(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_LIST, writeString(collectionName));
            if (response.status !== STATUS_OK)
                throw new Error(`Item List failed: ${getStatusString(response.status)}: ${response.message}`);
            const rawMap = JSON.parse(response.data.toString("utf8"));
            const decodedMap = {};
            for (const key in rawMap) {
                try {
                    if (collectionName === "_system" && key.startsWith("user:")) {
                        decodedMap[key] = JSON.parse(rawMap[key]);
                    }
                    else {
                        const decodedVal = Buffer.from(rawMap[key], "base64");
                        decodedMap[key] = JSON.parse(decodedVal.toString("utf8"));
                    }
                }
                catch (e) {
                    decodedMap[key] = rawMap[key];
                }
            }
            return { message: response.message, items: decodedMap };
        });
    }
    collectionQuery(collectionName, query) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = Buffer.concat([writeString(collectionName), writeBytes(Buffer.from(JSON.stringify(query)))]);
            const response = yield this.sendCommand(CMD_COLLECTION_QUERY, payload);
            if (response.status !== STATUS_OK)
                throw new Error(`Query failed: ${getStatusString(response.status)}: ${response.message}`);
            try {
                return JSON.parse(response.data.toString("utf8"));
            }
            catch (e) {
                throw new Error("Query failed: Invalid JSON response.");
            }
        });
    }
    isSessionAuthenticated() {
        return this.isAuthenticatedSession;
    }
    getAuthenticatedUsername() {
        return this.authenticatedUser;
    }
    close() {
        if (this.socket && !this.socket.destroyed) {
            this.socket.end();
        }
    }
}
export default MemoryToolsClient;

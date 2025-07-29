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
// Writes a length-prefixed string (uint32 length + string bytes)
function writeString(str) {
    // Writes a string prefixed by its length (4 bytes, little-endian).
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(Buffer.byteLength(str, "utf8"), 0);
    return Buffer.concat([lenBuffer, Buffer.from(str, "utf8")]);
}
// Writes a length-prefixed byte array (uint32 length + byte array)
function writeBytes(bytes) {
    // Writes a byte array prefixed by its length (4 bytes, little-endian).
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([lenBuffer, bytes]);
}
// Helper to read N bytes from the socket, handling partial reads
function readNBytes(socket, n) {
    // Reads exactly 'n' bytes from the socket.
    return new Promise((resolve, reject) => {
        const buffer = Buffer.alloc(n);
        let bytesRead = 0;
        const onData = (chunk) => {
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
    constructor(host, port, serverCertPath = null, rejectUnauthorized = true) {
        this.host = host;
        this.port = port;
        this.serverCertPath = serverCertPath;
        this.rejectUnauthorized = rejectUnauthorized;
        this.socket = null;
        this.connectingPromise = null;
    }
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
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
                let serverCert = undefined;
                if (this.serverCertPath) {
                    try {
                        serverCert = fs.readFileSync(this.serverCertPath);
                    }
                    catch (err) {
                        // Type 'any' for unknown error structure
                        return reject(new Error(`DBClient: Failed to read server certificate file: ${err.message}`));
                    }
                }
                const options = {
                    host: this.host,
                    port: this.port,
                    ca: serverCert ? [serverCert] : undefined,
                    rejectUnauthorized: this.rejectUnauthorized,
                    checkServerIdentity: (host, cert) => {
                        // Checks the server's certificate identity.
                        // Note: In Node.js >= 15.0.0, checkServerIdentity might not be strictly needed for IP addresses
                        // if you're correctly setting 'host' and 'servername' in TLS options.
                        // For self-signed CAs, ensure SANs match or pass rejectUnauthorized: false in dev.
                        if (net.isIP(this.host) &&
                            cert.subjectaltname &&
                            (cert.subjectaltname.includes(`IP:${this.host}`) ||
                                cert.subjectaltname.includes(`DNS:${this.host}`))) {
                            return undefined;
                        }
                        if (this.host === "localhost" &&
                            cert.subjectaltname &&
                            cert.subjectaltname.includes("DNS:localhost")) {
                            return undefined;
                        }
                        if (cert.subject && cert.subject.CN === this.host) {
                            return undefined;
                        }
                        console.warn(`DBClient: WARNING - Server certificate identity check failed for host ${this.host}. CN: ${cert.subject ? cert.subject.CN : "N/A"}, SANs: ${cert.subjectaltname || "N/A"}`);
                        return new Error("Certificate identity mismatch (for self-signed, ensure SANs match or relax check)");
                    },
                };
                this.socket = tls.connect(options, () => {
                    if (this.socket.authorized || !this.rejectUnauthorized) {
                        // Non-null assertion (!)
                        resolve(this.socket); // Non-null assertion (!)
                    }
                    else {
                        reject(new Error(`DBClient: TLS connection unauthorized: ${this.socket.authorizationError}` // Non-null assertion (!)
                        ));
                    }
                });
                this.socket.on("error", (err) => {
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
        });
    }
    // Sends a command and reads its response from the server
    sendCommand(commandType, payloadBuffer) {
        return __awaiter(this, void 0, void 0, function* () {
            // Sends a command to the server and awaits its response.
            if (!this.socket || this.socket.destroyed) {
                yield this.connect(); // Reconnect if disconnected
            }
            const commandBuffer = Buffer.concat([
                Buffer.from([commandType]),
                payloadBuffer,
            ]);
            this.socket.write(commandBuffer); // Non-null assertion (!) as connect() ensures it's not null
            // Read response (status, message, data)
            const statusByte = yield readNBytes(this.socket, 1);
            const status = statusByte.readUInt8(0);
            const msgLenBuffer = yield readNBytes(this.socket, 4);
            const msgLen = msgLenBuffer.readUInt32LE(0);
            const msgBuffer = yield readNBytes(this.socket, msgLen);
            const message = msgBuffer.toString("utf8");
            const dataLenBuffer = yield readNBytes(this.socket, 4);
            const dataLen = dataLenBuffer.readUInt32LE(0);
            let dataBuffer = Buffer.alloc(0);
            if (dataLen > 0) {
                dataBuffer = yield readNBytes(this.socket, dataLen);
            }
            return { status, message, data: dataBuffer };
        });
    }
    // --- Public API Methods ---
    set(key_1, value_1) {
        return __awaiter(this, arguments, void 0, function* (key, value, ttlSeconds = 0) {
            // Sets a key-value pair in the database with an optional TTL.
            const keyBuffer = writeString(key);
            const valueBuffer = writeBytes(Buffer.from(JSON.stringify(value)));
            const ttlBuffer = Buffer.alloc(8);
            ttlBuffer.writeBigInt64LE(BigInt(ttlSeconds), 0);
            const payload = Buffer.concat([keyBuffer, valueBuffer, ttlBuffer]);
            const response = yield this.sendCommand(CMD_SET, payload);
            if (response.status !== STATUS_OK) {
                throw new Error(`SET failed: ${response.message}`);
            }
            return response.message;
        });
    }
    get(key) {
        return __awaiter(this, void 0, void 0, function* () {
            // Retrieves a value by its key from the database.
            const keyBuffer = writeString(key);
            const payload = keyBuffer;
            const response = yield this.sendCommand(CMD_GET, payload);
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
                    value: JSON.parse(response.data.toString("utf8")), // Type assertion
                };
            }
            catch (e) {
                console.error(`DBClient: Error parsing GET value as JSON: ${e.message}. Raw: ${response.data.toString("utf8")}`);
                throw new Error(`GET failed: Invalid JSON format for stored value.`);
            }
        });
    }
    collectionCreate(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            // Creates a new collection.
            const payload = writeString(collectionName);
            const response = yield this.sendCommand(CMD_COLLECTION_CREATE, payload);
            if (response.status !== STATUS_OK) {
                throw new Error(`COLLECTION_CREATE failed: ${response.message}`);
            }
            return response.message;
        });
    }
    collectionDelete(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            // Deletes an existing collection.
            const payload = writeString(collectionName);
            const response = yield this.sendCommand(CMD_COLLECTION_DELETE, payload);
            if (response.status !== STATUS_OK) {
                throw new Error(`COLLECTION_DELETE failed: ${response.message}`);
            }
            return response.message;
        });
    }
    collectionList() {
        return __awaiter(this, void 0, void 0, function* () {
            // Lists all available collections.
            const payload = Buffer.alloc(0);
            const response = yield this.sendCommand(CMD_COLLECTION_LIST, payload);
            if (response.status !== STATUS_OK) {
                throw new Error(`COLLECTION_LIST failed: ${response.message}`);
            }
            try {
                const names = JSON.parse(response.data.toString("utf8"));
                return { message: response.message, names: names };
            }
            catch (e) {
                console.error(`DBClient: Error parsing COLLECTION_LIST response as JSON: ${e.message}. Raw: ${response.data.toString("utf8")}`);
                throw new Error(`COLLECTION_LIST failed: Invalid JSON format for collection names.`);
            }
        });
    }
    collectionItemSet(collectionName_1, key_1, value_1) {
        return __awaiter(this, arguments, void 0, function* (collectionName, key, value, ttlSeconds = 0) {
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
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_SET, payload);
            if (response.status !== STATUS_OK) {
                throw new Error(`COLLECTION_ITEM_SET failed: ${response.message}`);
            }
            return response.message;
        });
    }
    collectionItemGet(collectionName, key) {
        return __awaiter(this, void 0, void 0, function* () {
            // Retrieves an item from a specific collection by its key.
            const collectionNameBuffer = writeString(collectionName);
            const keyBuffer = writeString(key);
            const payload = Buffer.concat([collectionNameBuffer, keyBuffer]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_GET, payload);
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
                    value: JSON.parse(response.data.toString("utf8")),
                };
            }
            catch (e) {
                console.error(`DBClient: Error parsing COLLECTION_ITEM_GET value as JSON: ${e.message}. Raw: ${response.data.toString("utf8")}`);
                throw new Error(`COLLECTION_ITEM_GET failed: Invalid JSON format for stored value.`);
            }
        });
    }
    collectionItemDelete(collectionName, key) {
        return __awaiter(this, void 0, void 0, function* () {
            // Deletes an item from a specific collection by its key.
            const collectionNameBuffer = writeString(collectionName);
            const keyBuffer = writeString(key);
            const payload = Buffer.concat([collectionNameBuffer, keyBuffer]);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_DELETE, payload);
            if (response.status !== STATUS_OK) {
                throw new Error(`COLLECTION_ITEM_DELETE failed: ${response.message}`);
            }
            return response.message;
        });
    }
    collectionItemList(collectionName) {
        return __awaiter(this, void 0, void 0, function* () {
            // Lists all items and their values within a specific collection.
            const payload = writeString(collectionName);
            const response = yield this.sendCommand(CMD_COLLECTION_ITEM_LIST, payload);
            if (response.status !== STATUS_OK) {
                throw new Error(`COLLECTION_ITEM_LIST failed: ${response.message}`);
            }
            const rawMap = JSON.parse(response.data.toString("utf8")); // map<string, base64_string>
            const decodedMap = {}; // Use generic type T for values
            for (const key in rawMap) {
                try {
                    const decodedVal = Buffer.from(rawMap[key], "base64");
                    decodedMap[key] = JSON.parse(decodedVal.toString("utf8")); // Type assertion
                }
                catch (e) {
                    console.warn(`DBClient: Warning - Failed to Base64 decode or parse JSON for key '${key}' in collection item list: ${e.message}. Raw: ${rawMap[key]}`);
                    // If JSON parsing fails, we could keep the raw string or handle as error.
                    // For now, keeping the raw Base64 string for inspection.
                    // If 'T' is expected to always be a JSON object, this might warrant throwing an error.
                    decodedMap[key] = rawMap[key]; // Coerce to T, but this might break type safety if T is not string
                }
            }
            return { message: response.message, items: decodedMap };
        });
    }
    // Closes the underlying socket connection.
    close() {
        if (this.socket && !this.socket.destroyed) {
            this.socket.end();
        }
    }
}
// Export the client for use in other modules.
export default MemoryToolsClient;

# `memory-tools-client`

A Node.js client for interacting with the MemoryTools database via its TLS-based binary protocol.

---

## 🚀 Installation

To integrate `memory-tools-client` into your Node.js project, use npm:

```bash
npm install memory-tools-client
```

---

## 📖 Usage

### Initialization and Connection

The `MemoryToolsClient` class allows you to connect to your MemoryTools server. You can configure the TLS connection in several ways.

```javascript
import MemoryToolsClient from "memory-tools-client";
import path from "node:path"; // For handling certificate paths

// Your MemoryTools server configuration
const DB_HOST = "127.0.0.1";
const DB_PORT = 8080;

// TLS Connection Options:

// Option 1: Secure connection with server certificate verification (RECOMMENDED for production)
// You need the .crt file from your server.
const SERVER_CERT_PATH_SECURE = path.join(
  process.cwd(),
  "certificates",
  "server.crt"
);
const clientSecure = new MemoryToolsClient(
  DB_HOST,
  DB_PORT,
  SERVER_CERT_PATH_SECURE, // Path to the CA certificate that signed your server's certificate
  true // rejectUnauthorized: true (default)
);

// Option 2: Encrypted connection using system's default CAs (Secure if CA is trusted by OS)
// Node.js will use the operating system's default CAs. If your server uses a self-signed
// certificate not trusted by the OS, the connection will fail unless the CA is in the system store.
const clientSystemCA = new MemoryToolsClient(
  DB_HOST,
  DB_PORT,
  null, // serverCertPath: null (uses system CAs)
  true // rejectUnauthorized: true (default)
);

// Option 3: Encrypted connection without any server certificate verification (NOT RECOMMENDED for production)
// Useful for local development with self-signed certificates if you don't want
// to manage a certificate file on your client.
const clientInsecure = new MemoryToolsClient(
  DB_HOST,
  DB_PORT,
  null, // serverCertPath: null
  false // rejectUnauthorized: false (ignores verification)
);

async function runExample() {
  const client = clientSecure; // Choose the client instance you want to use for the example

  try {
    await client.connect();
    console.log("Connected to the MemoryTools database.");

    // Perform your database operations here
    // ...
  } catch (error) {
    console.error("Connection or operation error:", error.message);
  } finally {
    // Ensure the connection is closed when you're done
    if (client.socket && !client.socket.destroyed) {
      client.socket.end();
      console.log("Connection closed.");
    }
  }
}

runExample();
```

---

## ⚡ API Reference

The `MemoryToolsClient` class provides the following asynchronous methods to interact with your database:

### `constructor(host: string, port: number, serverCertPath?: string | null, rejectUnauthorized?: boolean)`

Creates a new client instance.

- **`host`** (`string`): The IP address or hostname of the MemoryTools server.
- **`port`** (`number`): The TLS port of the MemoryTools server.
- **`serverCertPath`** (`string | null`, optional, defaults to `null`):
  - If a `string`, it should be the path to the Certificate Authority (CA) certificate that signed your server's certificate. This certificate will be used to verify the server's identity.
  - If `null`, Node.js will attempt to use the operating system's default CAs for verification.
- **`rejectUnauthorized`** (`boolean`, optional, defaults to `true`):
  - If `true`, the connection will be rejected if the server's certificate cannot be verified by the provided CA or by the system's CAs.
  - If `false`, the connection will be established even if the server's certificate is invalid or cannot be verified. **Use with extreme caution in production environments.**

### `connect(): Promise<void>`

Establishes a TLS connection to the MemoryTools server. This method will automatically reconnect if the client is disconnected when `sendCommand` is called.

### `set(key: string, value: any, ttlSeconds?: number): Promise<string>`

Stores a value in the main key-value store. The `value` will be automatically JSON-serialized.

- **`key`** (`string`): The key to store the value under.
- **`value`** (`any`): The value to store. It will be converted to a JSON string.
- **`ttlSeconds`** (`number`, optional, defaults to `0`): Time-to-live in seconds. `0` means no expiration.

**Returns**: A `Promise` that resolves with a success message string from the server. **Throws**: An `Error` if the operation fails.

```javascript
await client.set(
  "myNodeKey",
  { message: "Hello from Node.js!", timestamp: Date.now() },
  300
);
console.log("Value set successfully.");
```

### `get(key: string): Promise<{ found: boolean, message: string, value: any | null }>`

Retrieves a value from the main key-value store. The retrieved value will be automatically JSON-parsed.

- **`key`** (`string`): The key of the value to retrieve.

**Returns**: A `Promise` that resolves to an object:

- **`found`** (`boolean`): `true` if the key was found, `false` otherwise.
- **`message`** (`string`): A status message from the server.
- **`value`** (`any | null`): The retrieved value, parsed from JSON, or `null` if not found. **Throws**: An `Error` if the operation fails (e.g., invalid JSON format for stored value, but not if the key is just not found).

```javascript
const result = await client.get("myNodeKey");
if (result.found) {
  console.log("Retrieved value:", result.value);
} else {
  console.log("Key not found:", result.message);
}
```

---

### Collection Operations

MemoryTools supports "collections" for organizing key-value pairs within named namespaces.

### `collectionCreate(collectionName: string): Promise<string>`

Creates a new collection.

- **`collectionName`** (`string`): The name of the collection to create.

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails.

```javascript
await client.collectionCreate("node_users");
console.log("Collection 'node_users' created.");
```

### `collectionDelete(collectionName: string): Promise<string>`

Deletes an entire collection and all its items.

- **`collectionName`** (`string`): The name of the collection to delete.

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails.

```javascript
await client.collectionDelete("node_users");
console.log("Collection 'node_users' deleted.");
```

### `collectionList(): Promise<{ message: string, names: string[] }>`

Lists all available collection names.

**Returns**: A `Promise` that resolves to an object:

- **`message`** (`string`): A status message from the server.
- **`names`** (`string[]`): An array of collection names. **Throws**: An `Error` if the operation fails.

```javascript
const listResult = await client.collectionList();
console.log("Available collections:", listResult.names);
```

### `collectionItemSet(collectionName: string, key: string, value: any, ttlSeconds?: number): Promise<string>`

Stores an item within a specific collection. The `value` will be automatically JSON-serialized.

- **`collectionName`** (`string`): The name of the collection.
- **`key`** (`string`): The key for the item within the collection.
- **`value`** (`any`): The value to store.
- **`ttlSeconds`** (`number`, optional, defaults to `0`): Time-to-live in seconds for this item. `0` means no expiration.

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails.

```javascript
await client.collectionItemSet(
  "node_users",
  "user_1",
  { name: "Alice", email: "alice@example.com" },
  3600
);
console.log("Item set in collection 'node_users'.");
```

### `collectionItemGet(collectionName: string, key: string): Promise<{ found: boolean, message: string, value: any | null }>`

Retrieves an item from a specific collection. The retrieved value will be automatically JSON-parsed.

- **`collectionName`** (`string`): The name of the collection.
- **`key`** (`string`): The key of the item to retrieve.

**Returns**: A `Promise` that resolves to an object:

- **`found`** (`boolean`): `true` if the item was found, `false` otherwise.
- **`message`** (`string`): A status message from the server.
- **`value`** (`any | null`): The retrieved value, parsed from JSON, or `null` if not found. **Throws**: An `Error` if the operation fails (e.g., invalid JSON format for stored value, but not if the item is just not found).

```javascript
const itemResult = await client.collectionItemGet("node_users", "user_1");
if (itemResult.found) {
  console.log("Retrieved user:", itemResult.value);
} else {
  console.log("User not found:", itemResult.message);
}
```

### `collectionItemDelete(collectionName: string, key: string): Promise<string>`

Deletes an item from a specific collection.

- **`collectionName`** (`string`): The name of the collection.
- **`key`** (`string`): The key of the item to delete.

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails.

```javascript
await client.collectionItemDelete("node_users", "user_1");
console.log("Item deleted from 'node_users'.");
```

### `collectionItemList(collectionName: string): Promise<{ message: string, items: { [key: string]: any } }>`

Lists all items and their values within a specific collection. Values are automatically JSON-parsed.

- **`collectionName`** (`string`): The name of the collection.

**Returns**: A `Promise` that resolves to an object:

- **`message`** (`string`): A status message from the server.
- **`items`** (`{ [key: string]: any }`): An object where keys are item keys and values are the parsed item data. **Throws**: An `Error` if the operation fails.

```javascript
const itemsResult = await client.collectionItemList("node_users");
console.log("Items in 'node_users':", itemsResult.items);
```

---

## 🔒 Security Considerations

- **TLS is Essential**: Always use TLS for connections to your MemoryTools server, especially in production environments, to ensure data encryption in transit.
- **Certificate Verification**: For production, it's **highly recommended** to set `rejectUnauthorized` to `true` (which is the default) and provide a `serverCertPath` to the CA certificate that signed your server's certificate. This verifies that you are connecting to the legitimate server and prevents man-in-the-middle attacks.
- **`rejectUnauthorized: false`**: Only use `rejectUnauthorized: false` for development or testing purposes, where the security implications are understood and acceptable (e.g., self-signed certificates in a controlled, isolated environment). Never use this in production.

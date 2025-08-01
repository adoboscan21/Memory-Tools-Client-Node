# MemoryTools Node.js Client

A Node.js client for interacting with the MemoryTools database via its TLS-based binary protocol.

---

## 🚀 Installation

To integrate `memory-tools-client` into your Node.js project, use npm:

```bash
npm install memory-tools-client
```

## 📖 Usage

### Initialization, Connection, and Authentication

The `MemoryToolsClient` class allows you to connect to your MemoryTools server and **authenticate**. Providing user credentials is highly recommended for most operations.

```javascript
import { MemoryToolsClient } from "memory-tools-client";
import path from "node:path"; // For handling certificate paths

// Your MemoryTools server configuration
const DB_HOST = "127.0.0.1";
const DB_PORT = 3443;
const DB_USER = "myuser"; // Your username!
const DB_PASS = "mypassword"; // Your password!

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
  DB_USER,
  DB_PASS,
  SERVER_CERT_PATH_SECURE, // Path to the CA certificate that signed your server's certificate
  true // rejectUnauthorized: true (default)
);

// Option 2: Encrypted connection using system's default CAs (Secure if CA is trusted by OS)
// Node.js will use the operating system's default CAs. If your server uses a self-signed
// certificate not trusted by the OS, the connection will fail unless the CA is in the system store.
const clientSystemCA = new MemoryToolsClient(
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASS,
  null, // serverCertPath: null (uses system CAs)
  true // rejectUnauthorized: true (default)
);

// Option 3: Encrypted connection without any server certificate verification (NOT RECOMMENDED for production)
// Useful for local development with self-signed certificates if you don't want
// to manage a certificate file on your client.
const clientInsecure = new MemoryToolsClient(
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASS,
  null, // serverCertPath: null
  false // rejectUnauthorized: false (ignores verification)
);

async function runExample() {
  const client = clientSecure; // Choose the client instance you want to use for the example

  try {
    await client.connect();
    console.log(
      `Connected and authenticated as ${client.getAuthenticatedUsername()} to the MemoryTools database.`
    );

    // Perform your database operations here
    // ...
  } catch (error) {
    console.error("Connection or operation error:", error.message);
  } finally {
    // Ensure the connection is closed when you're done
    client.close();
    console.log("Connection closed.");
  }
}

runExample();
```

---

## ⚡ API Reference

The `MemoryToolsClient` class provides the following asynchronous methods to interact with your database:

### `constructor(host: string, port: number, username: string | null = null, password: string | null = null, serverCertPath: string | null = null, rejectUnauthorized: boolean = true)`

Creates a new client instance.

- **`host`** (`string`): The IP address or hostname of the MemoryTools server.
- **`port`** (`number`): The TLS port of the MemoryTools server.
- **`username`** (`string | null`, optional, defaults to `null`): The username for authenticating with the server.
- **`password`** (`string | null`, optional, defaults to `null`): The password for authenticating with the server.
- **`serverCertPath`** (`string | null`, optional, defaults to `null`):
  - If a `string`, it should be the path to the Certificate Authority (CA) certificate that signed your server's certificate. This certificate will be used to verify the server's identity.
  - If `null`, Node.js will attempt to use the operating system's default CAs for verification.
- **`rejectUnauthorized`** (`boolean`, optional, defaults to `true`):
  - If `true`, the connection will be rejected if the server's certificate cannot be verified by the provided CA or by the system's CAs.
  - If `false`, the connection will be established even if the server's certificate is invalid or cannot be verified. **Use with extreme caution in production environments.**

### `connect(): Promise<tls.TLSSocket>`

Establishes a TLS connection to the MemoryTools server and, if `username` and `password` are provided in the constructor, will attempt to authenticate the session automatically. This method will return the `tls.TLSSocket` instance once connection and authentication are successful.

**Returns**: A `Promise` that resolves with the `tls.TLSSocket` object if connection and authentication are successful. **Throws**: An `Error` if connection or authentication fails.

```javascript
try {
  const socket = await client.connect();
  console.log("TLS connection established and authenticated.");
} catch (error) {
  console.error("Could not connect or authenticate:", error.message);
}
```

### `set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<string>`

Stores a value in the main key-value store. The `value` will be automatically JSON-serialized.

- **`key`** (`string`): The key to store the value under.
- **`value`** (`T`): The value to store. It will be converted to a JSON string.
- **`ttlSeconds`** (`number`, optional, defaults to `0`): Time-to-live in seconds. `0` means no expiration.

**Returns**: A `Promise` that resolves with a success message string from the server. **Throws**: An `Error` if the operation fails (including not being authenticated).

```javascript
await client.set(
  "myNodeKey",
  { message: "Hello from Node.js!", timestamp: Date.now() },
  300
);
console.log("Value set successfully.");
```

### `get<T = any>(key: string): Promise<{ found: boolean, message: string, value: T | null }>`

Retrieves a value from the main key-value store. The retrieved value will be automatically JSON-parsed.

- **`key`** (`string`): The key of the value to retrieve.

**Returns**: A `Promise` that resolves to an object:

- **`found`** (`boolean`): `true` if the key was found, `false` otherwise.
- **`message`** (`string`): A status message from the server.
- **`value`** (`T | null`): The retrieved value, parsed from JSON, or `null` if not found. **Throws**: An `Error` if the operation fails (e.g., invalid JSON format for stored value, or not being authenticated, but not if the key is just not found).

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

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails (including not being authenticated).

```javascript
await client.collectionCreate("node_users");
console.log("Collection 'node_users' created.");
```

### `collectionDelete(collectionName: string): Promise<string>`

Deletes an entire collection and all its items.

- **`collectionName`** (`string`): The name of the collection to delete.

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails (including not being authenticated).

```javascript
await client.collectionDelete("node_users");
console.log("Collection 'node_users' deleted.");
```

### `collectionList(): Promise<{ message: string, names: string[] }>`

Lists all available collection names.

**Returns**: A `Promise` that resolves to an object:

- **`message`** (`string`): A status message from the server.
- **`names`** (`string[]`): An array of collection names. **Throws**: An `Error` if the operation fails (including not being authenticated).

```javascript
const listResult = await client.collectionList();
console.log("Available collections:", listResult.names);
```

### `collectionItemSet<T = any>(collectionName: string, key: string, value: T, ttlSeconds?: number): Promise<string>`

Stores an item within a specific collection. The `value` will be automatically JSON-serialized.

- **`collectionName`** (`string`): The name of the collection.
- **`key`** (`string`): The key for the item within the collection.
- **`value`** (`T`): The value to store.
- **`ttlSeconds`** (`number`, optional, defaults to `0`): Time-to-live in seconds for this item. `0` means no expiration.

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails (including not being authenticated).

```javascript
await client.collectionItemSet(
  "node_users",
  "user_1",
  { name: "Alice", email: "alice@example.com" },
  3600
);
console.log("Item set in collection 'node_users'.");
```

### `collectionItemSetMany<T = any>(collectionName: string, values: T[]): Promise<string>`

Stores multiple items in a collection from an array of objects. Each object should have an `_id` field to be used as the item's key.

- **`collectionName`** (`string`): The name of the collection.
- **`values`** (`T[]`): An array of objects to store. Each object should have an `_id` field.

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails.

```javascript
await client.collectionItemSetMany("node_users", [
  { _id: "user_a", name: "Andres", email: "andres@example.com" },
  { _id: "user_b", name: "Alice", email: "alice@example.com" },
]);
console.log("Many items set in collection 'node_users'.");
```

### `collectionItemGet<T = any>(collectionName: string, key: string): Promise<{ found: boolean, message: string, value: T | null }>`

Retrieves an item from a specific collection. The retrieved value will be automatically JSON-parsed.

- **`collectionName`** (`string`): The name of the collection.
- **`key`** (`string`): The key of the item to retrieve.

**Returns**: A `Promise` that resolves to an object:

- **`found`** (`boolean`): `true` if the item was found, `false` otherwise.
- **`message`** (`string`): A status message from the server.
- **`value`** (`T | null`): The retrieved value, parsed from JSON, or `null` if not found. **Throws**: An `Error` if the operation fails (e.g., invalid JSON format for stored value, or not being authenticated, but not if the item is just not found).

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

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails (including not being authenticated).

```javascript
await client.collectionItemDelete("node_users", "user_1");
console.log("Item deleted from 'node_users'.");
```

### `collectionItemDeleteMany(collectionName: string, keys: string[]): Promise<string>`

Deletes multiple items from a collection by their keys.

- **`collectionName`** (`string`): The name of the collection.
- **`keys`** (`string[]`): An array of keys to delete.

**Returns**: A `Promise` that resolves with a success message. **Throws**: An `Error` if the operation fails.

```javascript
await client.collectionItemDeleteMany("node_users", ["user_a", "user_b"]);
console.log("Items deleted from 'node_users'.");
```

### `collectionItemList<T = any>(collectionName: string): Promise<{ message: string, items: { [key: string]: T } }>`

Lists all items and their values within a specific collection. Values are automatically JSON-parsed.

- **`collectionName`** (`string`): The name of the collection.

**Returns**: A `Promise` that resolves to an object:

- **`message`** (`string`): A status message from the server.
- **`items`** (`{ [key: string]: T }`): An object where keys are item keys and values are the parsed item data. **Throws**: An `Error` if the operation fails (including not being authenticated).

```javascript
const itemsResult = await client.collectionItemList("node_users");
console.log("Items in 'node_users':", itemsResult.items);
```

### `collectionQuery<T = any>(collectionName: string, query: Query): Promise<T>`

Executes a complex query on a specific collection.

- **`collectionName`** (`string`): The name of the collection.
- **`query`** (`Query`): The object defining filter, order, limit, aggregations, etc.

The `Query` interface is defined as:

```typescript
interface Query {
  filter?: { [key: string]: any }; // WHERE clause equivalents (AND, OR, NOT, LIKE, BETWEEN, IN, IS NULL)
  orderBy?: OrderByClause[]; // ORDER BY clause
  limit?: number; // LIMIT clause
  offset?: number; // OFFSET clause
  count?: boolean; // COUNT(*) equivalent
  aggregations?: { [key: string]: Aggregation }; // SUM, AVG, MIN, MAX
  groupBy?: string[]; // GROUP BY clause
  having?: { [key: string]: any }; // HAVING clause (filters aggregated results)
  distinct?: string; // DISTINCT field
}

interface OrderByClause {
  field: string;
  direction: "asc" | "desc"; // "asc" or "desc"
}

interface Aggregation {
  func: "sum" | "avg" | "min" | "max" | "count";
  field: string; // Field to aggregate on, "*" for count
}
```

**Returns**: A `Promise` that resolves with the query results as a generic type `T`. **Throws**: An `Error` if the operation fails or query JSON is invalid.

```javascript
// Example query for items in 'my_collection' where age > 25, ordered by name ascending, limit 2
const queryResult = await client.collectionQuery("my_collection", {
  filter: { field: "age", op: ">", value: 25 },
  orderBy: [{ field: "name", direction: "asc" }],
  limit: 2,
});
console.log("Query results:", queryResult);
```

### `isSessionAuthenticated(): boolean`

Returns `true` if the current client session is authenticated, `false` otherwise.

**Returns**: `boolean`

```javascript
if (client.isSessionAuthenticated()) {
  console.log("Client session is authenticated.");
} else {
  console.log("Client session is not authenticated.");
}
```

### `getAuthenticatedUsername(): string | null`

Returns the username of the currently authenticated user, or `null` if not authenticated.

**Returns**: `string | null`

```javascript
const username = client.getAuthenticatedUsername();
if (username) {
  console.log(`Authenticated user: ${username}`);
} else {
  console.log("No user authenticated.");
}
```

### `close(): void`

Closes the underlying socket connection. This also resets the session's authentication state.

```javascript
client.close();
console.log("Client connection closed.");
```

---

## 🔒 Security Considerations

- **TLS is Essential**: Always use TLS for connections to your MemoryTools server, especially in production environments, to ensure data encryption in transit.
- **Certificate Verification**: For production, it's **highly recommended** to set `rejectUnauthorized` to `true` (which is the default) and provide a `serverCertPath` to the CA certificate that signed your server's certificate. This verifies that you are connecting to the legitimate server and prevents man-in-the-middle attacks.
- **`rejectUnauthorized: false`**: Only use `rejectUnauthorized: false` for development or testing purposes, where the security implications are understood and acceptable (e.g., self-signed certificates in a controlled, isolated environment). Never use this in production.
- **Authentication Credentials**: Always pass user credentials (`username` and `password`) to the `MemoryToolsClient` constructor to ensure your operations are authorized. Without credentials, you may only be able to perform anonymous operations, which the server will likely restrict.
- **Credential Management**: Avoid hardcoding credentials in your code. Instead, use environment variables, a secret management service, or a secure configuration file to manage your database credentials.

---

## Support the Project!

Hello! I'm the developer behind **Memory Tools**. This is an open-source project.

I've dedicated a lot of time and effort to this project, and with your support, I can continue to maintain it, add new features, and make it better for everyone.

---

### How You Can Help

Every contribution, no matter the size, is a great help and is enormously appreciated. If you would like to support the continued development of this project, you can make a donation via PayPal.

You can donate directly to my PayPal account by clicking the link below:

**[Click here to donate](https://paypal.me/AdonayB?locale.x=es_XC&country.x=VE)**

---

### Other Ways to Contribute

If you can't donate, don't worry! You can still help in other ways:

- **Share the project:** Talk about it on social media or with your friends.
- **Report bugs:** If you find a problem, open an issue on GitHub.
- **Contribute code:** If you have coding skills, you can help improve the code.

  Thank you for your support!

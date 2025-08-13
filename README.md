# Memory Tools Node.js Client

An asynchronous Node.js client for interacting with the **Memory Tools** database via its secure, TLS-based binary protocol. This library is designed to be efficient, robust, and easy to use.

---

## 📖 Getting Started

### Connection and Basic Operations

The `MemoryToolsClient` class allows you to connect to your server. It's recommended to provide credentials for authentication. The client manages a persistent connection that should be closed when your application finishes.

```javascript
// For ESM: import MemoryToolsClient from "memory-tools-client";
const { MemoryToolsClient } = require("memory-tools-client");
const { randomUUID } = require("node:crypto");

// Server Configuration
const DB_HOST = "127.0.0.1";
const DB_PORT = 5876;
const DB_USER = "admin";
const DB_PASS = "adminpass";

// For production, set rejectUnauthorized to 'true' and provide a serverCertPath.
const client = new MemoryToolsClient(
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASS,
  null, // serverCertPath
  false // rejectUnauthorized
);

async function runExample() {
  try {
    await client.connect();
    console.log(`Connected and authenticated as: ${client.authenticatedUser}`);

    const collName = "users";
    await client.collectionCreate(collName);
    console.log(`✔ Collection '${collName}' created.`);

    // Set an item with an auto-generated UUID key
    const userValue = { name: "Elena", city: "Madrid", active: true };
    await client.collectionItemSet(collName, userValue);
    // The '_id' is automatically added to the userValue object
    console.log(`✔ User '${userValue._id}' set successfully.`);

    // Set an item with a specific key
    const specificKey = "user:marcos";
    await client.collectionItemSet(
      collName,
      { name: "Marcos", city: "Bogota", active: true },
      specificKey
    );
    console.log(`✔ User '${specificKey}' set successfully.`);

    // Get an item back
    const result = await client.collectionItemGet(collName, specificKey);
    if (result.found) {
      console.log("✔ Item retrieved:", result.value);
    }
  } catch (error) {
    console.error("✖ Connection or operation error:", error.message);
  } finally {
    // Ensure the connection is always closed
    client.close();
    console.log("Connection closed.");
  }
}

runExample();
```

### Atomic Transactions

For operations that must either all succeed or all fail, you can use transactions.

```javascript
async function transactionExample() {
  await client.connect();
  // ... create a collection 'accounts' ...

  // Start a transaction
  await client.begin();
  try {
    // Perform operations within the transaction
    await client.collectionItemUpdate("accounts", "acc1", { balance: 50 });
    await client.collectionItemUpdate("accounts", "acc2", { balance: 150 });

    // If all operations succeed, commit the changes
    await client.commit();
    console.log("✔ Transaction committed successfully.");
  } catch (error) {
    // If any operation fails, roll back all changes
    await client.rollback();
    console.error("✖ Transaction failed, changes were rolled back.");
  } finally {
    client.close();
  }
}
```

---

## 🔬 Advanced Queries with the `Query` Object

The `Query` interface is the most powerful feature of the client, allowing you to build complex, server-side queries. This is highly efficient as it avoids transferring entire collections over the network.

### Query Parameters

- `filter` (object): Defines conditions to select items (like a `WHERE` clause).
- `order_by` (array): Sorts the results based on one or more fields.
- `limit` (number): Restricts the maximum number of results returned.
- `offset` (number): Skips a specified number of results, used for pagination.
- `count` (boolean): If `true`, returns a count of matching items instead of the items themselves.
- `distinct` (string): Returns a list of unique values for the specified field.
- `group_by` (array): Groups results by one or more fields to perform aggregations.
- `aggregations` (object): Defines aggregation functions to run on groups (e.g., `SUM`, `AVG`, `COUNT`).
- `having` (object): Filters the results _after_ grouping and aggregation (like a `HAVING` clause).
- **`projection` (array of strings)**: Selects which fields to return, reducing network traffic.
- **`lookups` (array of objects)**: Enriches documents by joining data from other collections, similar to a `LEFT JOIN`.

### Building Filters

The `filter` object is the core of your query. It can be a single condition or a nested structure using logical operators like `and`, `or`, and `not`.

**Single Condition Structure:** `{ field: "field_name", op: "operator", value: ... }`

| Operator (`op`) | Description                                         | Example `value`            |
| --------------- | --------------------------------------------------- | -------------------------- |
| `=`             | Equal to                                            | `"some_string"` or `123`   |
| `!=`            | Not equal to                                        | `"some_string"` or `123`   |
| `>`             | Greater than                                        | `100`                      |
| `>=`            | Greater than or equal to                            | `100`                      |
| `<`             | Less than                                           | `50`                       |
| `<=`            | Less than or equal to                               | `50`                       |
| `like`          | Case-insensitive pattern matching (`%` is wildcard) | `"start%"` or `"%middle%"` |
| `in`            | Value is in a list of possibilities                 | `["value1", "value2"]`     |
| `between`       | Value is between two values (inclusive)             | `[10, 20]`                 |
| `is null`       | The field does not exist or is `null`               | `true` (or any value)      |
| `is not null`   | The field exists and is not `null`                  | `true` (or any value)      |

**Example: Complex Filter** This query finds all users who are active and older than 30.

```javascript
// Find active users with age > 30
const query = {
  filter: {
    and: [
      { field: "active", op: "=", value: true },
      { field: "age", op: ">", value: 30 },
    ],
  },
};
const results = await client.collectionQuery("users", query);
// Returns: [ { _id: 'u1', name: 'Elena', age: 34, active: true } ]
```

### Joins and Data Enrichment with `lookups`

The **`lookups`** parameter allows you to perform powerful server-side joins. It accepts an array of lookup objects, which are executed in a sequence (a pipeline).

**Example: Enriching Profiles with User Data** Based on our test data, let's query the `profiles` collection and join the user's information from the `users` collection.

```javascript
// Sample Data:
// users: [ { _id: 'u1', name: 'Elena' }, { _id: 'u2', name: 'Marcos' } ]
// profiles: [ { _id: 'p1', user_id: 'u1' }, { _id: 'p2', user_id: 'u2' } ]

const lookupQuery = {
  lookups: [
    {
      from: "users",
      localField: "user_id", // Field from the 'profiles' collection
      foreignField: "_id", // Field from the 'users' collection
      as: "user_info", // New field to store the joined user document
    },
  ],
};

const enrichedProfiles = await client.collectionQuery("profiles", lookupQuery);
console.log(JSON.stringify(enrichedProfiles, null, 2));
// Output:
// [
//   {
//     "_id": "p1", "user_id": "u1",
//     "user_info": { "_id": "u1", "name": "Elena" }
//   },
//   {
//     "_id": "p2", "user_id": "u2",
//     "user_info": { "_id": "u2", "name": "Marcos" }
//   }
// ]
```

### Deep Query Example: Aggregations & Grouping

You can perform powerful data analysis directly on the server.

**Example: Counting Active vs. Inactive Users** Let's group the `users` collection by the `active` field and count how many fall into each category.

```javascript
const analyticsQuery = {
  // 1. Group documents by the 'active' field
  group_by: ["active"],

  // 2. Define the aggregations to perform on each group
  aggregations: {
    userCount: { func: "count", field: "_id" }, // Count documents in each group
    maxAge: { func: "max", field: "age" }, // Find the max age in each group
  },
};

const report = await client.collectionQuery("users", analyticsQuery);
console.log(JSON.stringify(report, null, 2));
// Example output:
// [
//   { "active": true, "userCount": 2, "maxAge": 34 },
//   { "active": false, "userCount": 1, "maxAge": 45 }
// ]
```

## ⚡ API Reference

### Connection and Session

#### `constructor(host, port, username?, password?, serverCertPath?, rejectUnauthorized?)`

Creates a new client instance.

#### `connect(): Promise<tls.TLSSocket>`

Establishes the TLS connection and authenticates.

#### `close(): void`

Closes the underlying socket connection.

#### `isAuthenticatedSession` (property)

A `boolean` that is `true` if the client session is currently authenticated.

#### `authenticatedUser` (property)

A `string` containing the username of the authenticated user, or `null`.

### Transaction Operations

#### `begin(): Promise<string>`

Starts a new transaction.

#### `commit(): Promise<string>`

Commits the current transaction, making all changes permanent.

#### `rollback(): Promise<string>`

Rolls back the current transaction, discarding all changes.

### Collection & Index Operations

#### `collectionCreate(collectionName: string): Promise<string>`

Creates a new collection.

#### `collectionDelete(collectionName: string): Promise<string>`

Deletes an entire collection.

#### `collectionList(): Promise<string[]>`

Lists all accessible collection names.

#### `collectionIndexCreate(collectionName: string, fieldName: string): Promise<string>`

Creates an index on a field to speed up queries.

#### `collectionIndexDelete(collectionName: string, fieldName: string): Promise<string>`

Deletes an index.

#### `collectionIndexList(collectionName: string): Promise<string[]>`

Lists all indexed fields for a collection.

### Item (CRUD) Operations

#### `collectionItemSet<T>(collName: string, value: T, key?: string, ttl?: number): Promise<string>`

Stores an item. If `key` is omitted, a UUID is generated and assigned to the `_id` property of the `value` object.

#### `collectionItemSetMany<T>(collName: string, items: T[]): Promise<string>`

Stores multiple items. Assigns a UUID to the `_id` field of any item that lacks one.

#### `collectionItemUpdate<T>(collName: string, key: string, patchValue: Partial<T>): Promise<string>`

Partially updates an item.

#### `collectionItemUpdateMany<T>(collName: string, items: { _id: string, patch: Partial<T> }[]): Promise<string>`

Partially updates multiple items in a batch.

#### `collectionItemGet<T>(collName: string, key: string): Promise<GetResult<T>>`

Retrieves an item. Returns `{ found: boolean, value: T | null }`.

#### `collectionItemDelete(collName:string, key: string): Promise<string>`

Deletes an item by its key.

#### `collectionItemDeleteMany(collName: string, keys: string[]): Promise<string>`

Deletes multiple items by their keys.

### Query Operations

#### `collectionQuery<T>(collectionName: string, query: Query): Promise<T>`

Executes a complex query. See the "Advanced Queries" section for details.

---

## 🔒 Security Considerations

- **TLS is Essential**: Always use TLS to encrypt data in transit.
- **Certificate Verification**: For production, always set `rejectUnauthorized` to `true` (the default) and provide a `serverCertPath` to prevent man-in-the-middle attacks.
- **Credential Management**: Avoid hardcoding credentials. Use environment variables or a secret management service like HashiCorp Vault or AWS Secrets Manager.

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

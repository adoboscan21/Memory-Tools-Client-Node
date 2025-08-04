# Memory Tools Node.js Client

An asynchronous Node.js client for interacting with the **Memory Tools** database via its secure, TLS-based binary protocol.

---

## 🚀 Installation

To integrate the client into your Node.js project, use npm:

```bash
npm install memory-tools-client
```

---

## 📖 Getting Started

### Connection and Basic Operations

The `MemoryToolsClient` class allows you to connect to your server. It's recommended to provide credentials for authentication. The client manages a persistent connection that should be closed when your application finishes.

```javascript
import MemoryToolsClient from "memory-tools-client";

// Server Configuration
const DB_HOST = "127.0.0.1";
const DB_PORT = 5876;
const DB_USER = "admin";
const DB_PASS = "adminpass";

// For local development with self-signed certs, you might disable verification.
// For production, set this to 'true' and provide a serverCertPath.
const client = new MemoryToolsClient(
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASS,
  null,
  false
);

async function runExample() {
  try {
    await client.connect();
    console.log(`Connected and authenticated as: ${client.authenticatedUser}`);

    const collName = "my-products";
    await client.collectionCreate(collName);
    console.log(`✔ Collection '${collName}' created.`);

    // Set an item in the collection
    const itemKey = "product:101";
    const itemValue = {
      name: "Laptop Pro",
      category: "electronics",
      price: 1200,
    };
    await client.collectionItemSet(collName, itemKey, itemValue);
    console.log(`✔ Item '${itemKey}' set successfully.`);

    // Get the item back
    const result = await client.collectionItemGet(collName, itemKey);
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

---

## 🔬 Advanced Queries with the `Query` Object

The `Query` interface is the most powerful feature of the client, allowing you to build complex, server-side queries. This is highly efficient as it avoids transferring entire collections over the network.

### Query Parameters

You create a `Query` object by passing properties:

- `filter` (object): Defines conditions to select items (like a `WHERE` clause).
- `orderBy` (array): Sorts the results based on one or more fields.
- `limit` (number): Restricts the maximum number of results returned.
- `offset` (number): Skips a specified number of results, used for pagination.
- `count` (boolean): If `true`, returns a count of matching items instead of the items themselves.
- `distinct` (string): Returns a list of unique values for the specified field.
- `groupBy` (array): Groups results by one or more fields to perform aggregations.
- `aggregations` (object): Defines aggregation functions to run on groups (e.g., `SUM`, `AVG`, `COUNT`).
- `having` (object): Filters the results _after_ grouping and aggregation (like a `HAVING` clause).

### Building Filters

The `filter` object is the core of your query. It can be a single condition or a nested structure using logical operators.

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

**Logical Operators (`and`, `or`, `not`):**

You can combine conditions into complex logic.

```javascript
// Query: Find electronics with a price over 500 OR items in the 'books' category
const query = {
  filter: {
    or: [
      {
        and: [
          { field: "category", op: "=", value: "electronics" },
          { field: "price", op: ">", value: 500 },
        ],
      },
      { field: "category", op: "=", value: "books" },
    ],
  },
};
const results = await client.collectionQuery("products", query);
```

### Deep Query Example: Aggregations & Grouping

You can perform powerful data analysis directly on the server.

```javascript
// Query: For products with a price over 100, group them by category.
// Then, count how many products are in each category and calculate the average price.
// Finally, only return categories having more than 5 products.

const deepQuery = {
  // 1. Initial Filtering (WHERE)
  filter: { field: "price", op: ">", value: 100 },

  // 2. Grouping
  groupBy: ["category"],

  // 3. Aggregations to perform on each group
  aggregations: {
    productCount: { func: "count", field: "_id" },
    averagePrice: { func: "avg", field: "price" },
  },

  // 4. Filtering on aggregated results (HAVING)
  having: { field: "productCount", op: ">", value: 5 },

  // 5. Ordering the final results
  orderBy: [{ field: "averagePrice", direction: "desc" }],
};

const analyticsResult = await client.collectionQuery("products", deepQuery);
console.log(JSON.stringify(analyticsResult, null, 2));
// Example output:
// [
//   { "category": "electronics", "productCount": 15, "averagePrice": 850.75 },
//   { "category": "appliances", "productCount": 8, "averagePrice": 620.50 }
// ]
```

---

## ⚡ API Reference

### Connection and Session

#### `constructor(host, port, username?, password?, serverCertPath?, rejectUnauthorized?)`

Creates a new client instance.

- **`host`** (`string`): The IP address or hostname of the server.
- **`port`** (`number`): The TLS port of the server.
- **`username`** (`string`, optional): Username for authentication.
- **`password`** (`string`, optional): Password for authentication.
- **`serverCertPath`** (`string`, optional): Path to the CA certificate for verification.
- **`rejectUnauthorized`** (`boolean`, optional): Defaults to `true`.

#### `connect(): Promise<tls.TLSSocket>`

Establishes the TLS connection and authenticates.

#### `close(): void`

Closes the underlying socket connection.

#### `isAuthenticatedSession` (property)

A `boolean` that is `true` if the client session is currently authenticated.

#### `authenticatedUser` (property)

A `string` containing the username of the authenticated user, or `null`.

### Collection Operations

#### `collectionCreate(collectionName: string): Promise<string>`

Creates a new collection.

#### `collectionDelete(collectionName: string): Promise<string>`

Deletes an entire collection and all its items.

#### `collectionList(): Promise<string[]>`

Lists the names of all collections the user can access.

### Index Operations

#### `collectionIndexCreate(collectionName: string, fieldName: string): Promise<string>`

Creates an index on a specific field to speed up queries.

#### `collectionIndexDelete(collectionName: string, fieldName: string): Promise<string>`

Deletes an index from a collection.

#### `collectionIndexList(collectionName: string): Promise<string[]>`

Lists all indexed fields for a collection.

### Collection Item Operations

#### `collectionItemSet<T>(collName: string, key: string, value: T, ttl?: number): Promise<string>`

Stores an item within a collection.

#### `collectionItemSetMany<T>(collName: string, items: T[]): Promise<string>`

Stores multiple items in a batch. Each object in `items` should have an `_id` field.

#### `collectionItemUpdate<T>(collName: string, key: string, patchValue: Partial<T>): Promise<string>`

Partially updates an item. Only the fields in `patchValue` are modified.

#### `collectionItemUpdateMany<T>(collName: string, items: { _id: string, patch: Partial<T> }[]): Promise<string>`

Partially updates multiple items in a batch.

#### `collectionItemGet<T>(collName: string, key: string): Promise<GetResult<T>>`

Retrieves an item. Returns a `GetResult` object with `.found` and `.value`.

#### `collectionItemDelete(collName: string, key: string): Promise<string>`

Deletes an item by its key.

#### `collectionItemDeleteMany(collName: string, keys: string[]): Promise<string>`

Deletes multiple items by their keys in a batch.

#### `collectionItemList<T>(collName: string): Promise<CollectionItemList<T>>`

Lists all items in a collection. **Warning:** Use with caution on large collections.

### Query Operations

#### `collectionQuery<T>(collectionName: string, query: Query): Promise<T>`

Executes a complex query. See the "Advanced Queries" section for details.

---

## 🔒 Security Considerations

- **TLS is Essential**: Always use TLS to encrypt data in transit.
- **Certificate Verification**: For production, always set `rejectUnauthorized` to `true` (the default) and provide a `serverCertPath`. This prevents man-in-the-middle attacks.
- **Credential Management**: Avoid hardcoding credentials. Use environment variables or a secret management service.

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

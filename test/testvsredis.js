// test memory-tools vs redis

import { MemoryToolsClient } from "../memory-tools-client.js";
import { createClient } from "redis";

async function runTests() {
  console.log("Starting performance comparison tests (My DB vs Redis)...");

  // My DB Clients
  let clientAdmin = null;

  // Redis Client
  const redisClient = createClient({
    url: "redis://127.0.0.1:6379",
  });
  redisClient.on("error", (err) =>
    console.log("Redis Client Error", err)
  );

  try {
    // --- Connect to My DB ---
    clientAdmin = new MemoryToolsClient(
      "127.0.0.1",
      8080,
      "admin",
      "adminpass", // <-- UPDATE THIS LINE WITH YOUR ACTUAL ADMIN USER PASSWORD!
      null,
      false
    );
    console.log("\nAttempting to connect to My DB...");
    console.time("MyDB_ConnectAuth");
    await clientAdmin.connect();
    console.timeEnd("MyDB_ConnectAuth");
    console.log(`✔ Success: Connected to My DB as: ${clientAdmin.getAuthenticatedUsername()}`);

    // --- Connect to Redis ---
    console.log("\nAttempting to connect to Redis...");
    console.time("Redis_Connect");
    await redisClient.connect();
    console.timeEnd("Redis_Connect");
    console.log("✔ Success: Connected to Redis.");

    // --- My DB Test: Main Store Operations ---
    console.log("\n--- My DB Test: Main Store Operations ---");
    const testKey = "my_node_key";
    const testValue = {
      data: "Node.js main store test",
      timestamp: Date.now(),
    };
    const updatedValue = { data: "Node.js main store updated", status: "ok" };
    let retrievedMainItem;

    // 1. Set a key-value pair
    console.time("MyDB_MainStore_Set");
    await clientAdmin.set(testKey, testValue, 60);
    console.timeEnd("MyDB_MainStore_Set");
    console.log(`✔ Success: Key '${testKey}' set in My DB.`);

    // 2. Get the key-value pair
    console.time("MyDB_MainStore_Get");
    retrievedMainItem = await clientAdmin.get(testKey);
    console.timeEnd("MyDB_MainStore_Get");
    if (retrievedMainItem.found) {
      console.log(`✔ Success: Key '${testKey}' retrieved from My DB.`);
    }

    // 3. Update the key-value pair
    console.time("MyDB_MainStore_Set_Update");
    await clientAdmin.set(testKey, updatedValue);
    console.timeEnd("MyDB_MainStore_Set_Update");
    console.log(`✔ Success: Key '${testKey}' updated in My DB.`);

    // 4. Delete the key-value pair
    console.time("MyDB_MainStore_Delete");
    await clientAdmin.set(testKey, null, 0);
    console.timeEnd("MyDB_MainStore_Delete");
    console.log(`✔ Success: Key '${testKey}' deleted from My DB.`);

    // --- Redis Test: Main Store Operations (string keys) ---
    console.log("\n--- Redis Test: Main Store Operations ---");
    let retrievedRedisItem;

    // 1. Set a key-value pair
    console.time("Redis_MainStore_Set");
    await redisClient.set(testKey, JSON.stringify(testValue), { EX: 60 });
    console.timeEnd("Redis_MainStore_Set");
    console.log(`✔ Success: Key '${testKey}' set in Redis.`);

    // 2. Get the key-value pair
    console.time("Redis_MainStore_Get");
    retrievedRedisItem = await redisClient.get(testKey);
    console.timeEnd("Redis_MainStore_Get");
    if (retrievedRedisItem) {
      console.log(`✔ Success: Key '${testKey}' retrieved from Redis.`);
      // No need to parse the JSON here just for the performance test
    }

    // 3. Update the key-value pair
    console.time("Redis_MainStore_Set_Update");
    await redisClient.set(testKey, JSON.stringify(updatedValue));
    console.timeEnd("Redis_MainStore_Set_Update");
    console.log(`✔ Success: Key '${testKey}' updated in Redis.`);

    // 4. Delete the key-value pair
    console.time("Redis_MainStore_Delete");
    await redisClient.del(testKey);
    console.timeEnd("Redis_MainStore_Delete");
    console.log(`✔ Success: Key '${testKey}' deleted from Redis.`);

    // --- My DB Test: Collection Operations ---
    console.log("\n--- My DB Test: Collection Operations ---");
    const testCollectionName = "my_nodejs_data";
    const itemKey1 = "item_from_node_1";
    const itemValue1 = { message: "Hello from Node.js item 1!" };
    const itemKey2 = "item_from_node_2";
    const itemValue2 = { message: "Hello from Node.js item 2!", version: 2 };

    // 1. Create a collection
    console.time("MyDB_Collection_Create");
    await clientAdmin.collectionCreate(testCollectionName);
    console.timeEnd("MyDB_Collection_Create");
    console.log(`✔ Success: Collection '${testCollectionName}' created in My DB.`);

    // 2. Set an item in the collection
    console.time("MyDB_CollectionItem_Set");
    await clientAdmin.collectionItemSet(testCollectionName, itemKey1, itemValue1);
    await clientAdmin.collectionItemSet(testCollectionName, itemKey2, itemValue2, 10);
    console.timeEnd("MyDB_CollectionItem_Set");
    console.log(`✔ Success: Items set in My DB collection '${testCollectionName}'.`);

    // 3. Get an item from the collection
    console.time("MyDB_CollectionItem_Get");
    await clientAdmin.collectionItemGet(testCollectionName, itemKey1);
    console.timeEnd("MyDB_CollectionItem_Get");
    console.log(`✔ Success: Item '${itemKey1}' retrieved from My DB collection.`);

    // 4. List items in the collection
    console.time("MyDB_CollectionItem_List");
    await clientAdmin.collectionItemList(testCollectionName);
    console.timeEnd("MyDB_CollectionItem_List");
    console.log(`✔ Success: Items listed from My DB collection '${testCollectionName}'.`);

    // 5. Delete an item
    console.time("MyDB_CollectionItem_Delete");
    await clientAdmin.collectionItemDelete(testCollectionName, itemKey1);
    console.timeEnd("MyDB_CollectionItem_Delete");
    console.log(`✔ Success: Item '${itemKey1}' deleted from My DB collection.`);

    // 6. Delete the test collection
    console.time("MyDB_Collection_Delete");
    await clientAdmin.collectionDelete(testCollectionName);
    console.timeEnd("MyDB_Collection_Delete");
    console.log(`✔ Success: Collection '${testCollectionName}' deleted from My DB.`);


    // --- Redis Test: Collection Operations (using Hash) ---
    console.log("\n--- Redis Test: Collection Operations (using Hash) ---");
    const redisCollectionName = "my_nodejs_data";

    // 1. Create a collection (no direct op, simulating via hset)
    // No time to measure, as it's not a distinct operation.
    console.log(`✔ Success: Collection '${redisCollectionName}' created in Redis (conceptually).`);

    // 2. Set an item in the collection
    console.time("Redis_CollectionItem_Set");
    // HSET does not support a per-field TTL, so this is an approximation.
    await redisClient.hSet(redisCollectionName, itemKey1, JSON.stringify(itemValue1));
    await redisClient.hSet(redisCollectionName, itemKey2, JSON.stringify(itemValue2));
    await redisClient.expire(redisCollectionName, 10); // Expire the whole collection hash
    console.timeEnd("Redis_CollectionItem_Set");
    console.log(`✔ Success: Items set in Redis collection '${redisCollectionName}'.`);

    // 3. Get an item from the collection
    console.time("Redis_CollectionItem_Get");
    await redisClient.hGet(redisCollectionName, itemKey1);
    console.timeEnd("Redis_CollectionItem_Get");
    console.log(`✔ Success: Item '${itemKey1}' retrieved from Redis collection.`);

    // 4. List items in the collection
    console.time("Redis_CollectionItem_List");
    await redisClient.hGetAll(redisCollectionName);
    console.timeEnd("Redis_CollectionItem_List");
    console.log(`✔ Success: Items listed from Redis collection '${redisCollectionName}'.`);

    // 5. Delete an item
    console.time("Redis_CollectionItem_Delete");
    await redisClient.hDel(redisCollectionName, itemKey1);
    console.timeEnd("Redis_CollectionItem_Delete");
    console.log(`✔ Success: Item '${itemKey1}' deleted from Redis collection.`);

    // 6. Delete the test collection
    console.time("Redis_Collection_Delete");
    await redisClient.del(redisCollectionName);
    console.timeEnd("Redis_Collection_Delete");
    console.log(`✔ Success: Collection '${redisCollectionName}' deleted from Redis.`);

    // --- My DB Test: Collection Queries ---
    console.log("\n--- My DB Test: Collection Query (complex) ---");
    const queryCollectionName = "users";

    // Query 1: Users with email in example.com, ordered by name ASC
    console.time("MyDB_Query_1_EmailLike");
    await clientAdmin.collectionQuery(queryCollectionName, {
      filter: { field: "email", op: "like", value: "%@example.com" },
      orderBy: [{ field: "name", direction: "asc" }],
    });
    console.timeEnd("MyDB_Query_1_EmailLike");
    console.log("✔ Success: Query 1 (email like) completed for My DB.");

    // Query 2: Users > 25 years old AND (admin OR moderator role)
    console.time("MyDB_Query_2_AgeRole");
    await clientAdmin.collectionQuery(queryCollectionName, {
      filter: {
        and: [
          { field: "age", op: ">", value: 25 },
          {
            or: [
              { field: "role", op: "=", value: "admin" },
              { field: "role", op: "=", value: "moderator" },
            ],
          },
        ],
      },
    });
    console.timeEnd("MyDB_Query_2_AgeRole");
    console.log("✔ Success: Query 2 (age & role) completed for My DB.");
    
    // Query 3: Count active users
    console.time("MyDB_Query_3_CountActive");
    await clientAdmin.collectionQuery(queryCollectionName, {
      count: true,
      filter: { field: "status", op: "=", value: "active" },
    });
    console.timeEnd("MyDB_Query_3_CountActive");
    console.log("✔ Success: Query 3 (count active) completed for My DB.");

    // Query 4: 5 most recent users (ordered by created_at DESC)
    console.time("MyDB_Query_4_MostRecent");
    await clientAdmin.collectionQuery(queryCollectionName, {
      orderBy: [{ field: "created_at", direction: "desc" }],
      limit: 5,
    });
    console.timeEnd("MyDB_Query_4_MostRecent");
    console.log("✔ Success: Query 4 (most recent) completed for My DB.");

    // --- Redis Test: Collection Queries ---
    console.log("\n--- Redis Test: Collection Query (complex) ---");
    console.log("❌ Note: Redis does not have native collection querying with filter, sort, and aggregation on JSON data inside a hash. This requires a full client-side scan and processing, which is not a fair performance comparison and would likely be much slower.");

  } catch (error) {
    console.error(`\n--- UNEXPECTED ERROR DURING TESTS ---`);
    console.error(`Error: ${error.message}`);
  } finally {
    console.log("\nClosing connections...");
    clientAdmin?.close();
    await redisClient.quit();
    console.log("--- All tests finished ---");
  }
}

runTests();
import MemoryToolsClient from "../memory-tools-client.js";

async function runTests() {
  console.log("Starting Memory Tools client tests...");

  // --- Test: Failed Authentication ---
  console.log("\n--- Test: Failed Authentication (incorrect credentials) ---");
  let clientBadAuth = null;
  try {
    clientBadAuth = new MemoryToolsClient(
      "127.0.0.1",
      5876,
      "bad_user",
      "bad_pass",
      null,
      false
    );
    await clientBadAuth.connect();
    console.log(
      "✖ Error: Authentication with incorrect credentials unexpectedly succeeded."
    );
  } catch (error) {
    console.log(
      `✔ Success: Authentication failed as expected: ${error.message}`
    );
  } finally {
    clientBadAuth?.close();
  }

  // --- Test: 'root' User Connection ---
  console.log("\n--- Test: 'root' User Connection (localhost only) ---");
  let clientRoot = null;
  try {
    clientRoot = new MemoryToolsClient(
      "127.0.0.1",
      5876,
      "root",
      "rootpass",
      null,
      false
    );
    await clientRoot.connect();
    console.log(
      `✔ Success: Connected and authenticated as '${clientRoot.getAuthenticatedUsername()}'.`
    );
  } catch (error) {
    console.error(
      `✖ Error: Unexpected error during root tests: ${error.message}`
    );
  } finally {
    clientRoot?.close();
  }

  // --- Main Test Suite with 'admin' User ---
  console.log("\n--- Starting Main Test Suite with 'admin' User ---");
  let clientAdmin = null;
  try {
    clientAdmin = new MemoryToolsClient(
      "127.0.0.1",
      5876,
      "admin",
      "adminpass",
      null,
      false
    );

    console.time("Admin_Connect_And_Auth");
    await clientAdmin.connect();
    console.timeEnd("Admin_Connect_And_Auth");

    if (clientAdmin.isSessionAuthenticated()) {
      console.log(
        `✔ Success: Connected and authenticated as '${clientAdmin.getAuthenticatedUsername()}'. Session is active.`
      );
    } else {
      throw new Error("Session is not authenticated after connect.");
    }

    // --- Main Store Operations ---
    console.log("\n--- Testing Main Store Operations ---");
    const testKey = "main_store_key";
    const testValue = { app: "Node.js Test", ver: 1.0 };

    console.time("MainStore_Set");
    await clientAdmin.set(testKey, testValue, 60);
    console.timeEnd("MainStore_Set");
    console.log(`✔ Success: Key '${testKey}' set.`);

    console.time("MainStore_Get");
    const result = await clientAdmin.get(testKey);
    console.timeEnd("MainStore_Get");
    if (
      result.found &&
      JSON.stringify(result.value) === JSON.stringify(testValue)
    ) {
      console.log(`✔ Success: Key '${testKey}' retrieved and verified.`);
    } else {
      console.error("✖ Error: Main store GET verification failed.");
    }

    // Note: Main store delete is done by setting a key to null with 0 TTL
    console.time("MainStore_Delete");
    await clientAdmin.set(testKey, null, 0);
    console.timeEnd("MainStore_Delete");
    const deletedResult = await clientAdmin.get(testKey);
    if (!deletedResult.found) {
      console.log(`✔ Success: Key '${testKey}' deleted.`);
    } else {
      console.error("✖ Error: Main store key deletion failed.");
    }

    // --- Full Collection Lifecycle ---
    console.log("\n--- Testing Full Collection Lifecycle ---");
    const collName = "node_test_coll";

    await clientAdmin.collectionCreate(collName);
    console.log(`✔ Success: Collection '${collName}' created.`);
    let collections = await clientAdmin.collectionList();
    if (collections.names.includes(collName)) {
      console.log(`✔ Success: Collection '${collName}' found in list.`);
    } else {
      console.error(
        `✖ Error: Collection '${collName}' not in list after creation.`
      );
    }

    // --- Item and Index Operations ---
    const item1 = { _id: "item1", user: "alpha", value: 100 };
    const item2 = { _id: "item2", user: "beta", value: 200 };
    const manyItems = [
      { _id: "many1", user: "charlie", value: 300 },
      { _id: "many2", user: "alpha", value: 400 },
    ];

    console.log("\n--- Testing Item Operations ---");
    await clientAdmin.collectionItemSet(collName, item1._id, item1);
    await clientAdmin.collectionItemSet(collName, item2._id, item2);
    console.log("✔ Success: Set 2 individual items.");

    const retrievedItem = await clientAdmin.collectionItemGet(
      collName,
      item1._id
    );
    if (retrievedItem.found && retrievedItem.value._id === item1._id) {
      console.log(
        `✔ Success: collectionItemGet retrieved '${item1._id}' correctly.`
      );
    } else {
      console.error(`✖ Error: collectionItemGet failed for '${item1._id}'.`);
    }

    await clientAdmin.collectionItemSetMany(collName, manyItems);
    console.log("✔ Success: Set many items.");

    console.log("\n--- Testing Index Operations ---");
    await clientAdmin.collectionIndexCreate(collName, "user");
    console.log("✔ Success: Index on 'user' created.");

    let indexes = await clientAdmin.collectionIndexList(collName);
    if (Array.isArray(indexes) && indexes.includes("user")) {
      console.log(`✔ Success: Index list verified: [${indexes.join(", ")}]`);
    } else {
      console.error(`✖ Error: Index 'user' not found in list.`);
    }

    // --- Query Operations ---
    console.log("\n--- Testing Query Operations ---");
    const queryResult = await clientAdmin.collectionQuery(collName, {
      filter: { field: "user", op: "=", value: "alpha" },
      orderBy: [{ field: "value", direction: "desc" }],
    });

    if (queryResult.length === 2 && queryResult[0]._id === "many2") {
      console.log(
        "✔ Success: Query for user 'alpha' returned correct results and order."
      );
    } else {
      console.error(
        `✖ Error: Query result mismatch. Found ${queryResult.length} items.`
      );
    }

    const countResult = await clientAdmin.collectionQuery(collName, {
      count: true,
    });
    if (countResult.count === 4) {
      console.log(
        `✔ Success: Count query returned correct count: ${countResult.count}`
      );
    } else {
      console.error(
        `✖ Error: Count query returned ${countResult.count}, expected 4.`
      );
    }

    // --- Cleanup Operations ---
    console.log("\n--- Testing Cleanup Operations ---");
    await clientAdmin.collectionIndexDelete(collName, "user");
    console.log("✔ Success: Index on 'user' deleted.");
    indexes = await clientAdmin.collectionIndexList(collName);
    if (indexes.length === 0) {
      console.log(`✔ Success: Index list is empty after deletion.`);
    } else {
      console.error(`✖ Error: Index list not empty after deletion.`);
    }

    await clientAdmin.collectionItemDelete(collName, "item1");
    console.log("✔ Success: Deleted 'item1'.");

    await clientAdmin.collectionItemDeleteMany(collName, ["many1", "many2"]);
    console.log("✔ Success: Deleted many items.");

    const finalList = await clientAdmin.collectionItemList(collName);
    if (Object.keys(finalList.items).length === 1 && finalList.items.item2) {
      console.log("✔ Success: Correct item remains after deletions.");
    } else {
      console.error("✖ Error: Incorrect items remain after deletions.");
    }

    await clientAdmin.collectionDelete(collName);
    console.log(`✔ Success: Collection '${collName}' deleted.`);
    collections = await clientAdmin.collectionList();
    if (!collections.names.includes(collName)) {
      console.log(`✔ Success: Collection '${collName}' no longer in list.`);
    } else {
      console.error(
        `✖ Error: Collection '${collName}' still in list after deletion.`
      );
    }
  } catch (error) {
    console.error(`\n--- 💥 UNEXPECTED ERROR DURING TESTS 💥 ---`);
    console.error(`Error: ${error.message}`);
    if (error.message.includes("ECONNREFUSED")) {
      console.error("Hint: Is the Go server running? `go run ./cmd/server`");
    }
  } finally {
    console.log("\nClosing connection...");
    clientAdmin?.close();
    console.log("--- All tests finished ---");
  }
}

runTests();

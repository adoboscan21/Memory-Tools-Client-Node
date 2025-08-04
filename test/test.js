import MemoryToolsClient from "../memory-tools-client.js";
import assert from "node:assert";

// --- Configuration ---
const HOST = "127.0.0.1";
const PORT = 5876;
const ADMIN_USER = "admin";
const ADMIN_PASS = "adminpass";
// For local testing, cert validation is often disabled.
const CERT_PATH = null;
const REJECT_UNAUTHORIZED = false;

async function runTests() {
  console.log("🚀 Starting Memory Tools JavaScript client tests...");

  // --- Test: Failed Authentication ---
  console.log("\n--- Test: Failed Authentication (incorrect credentials) ---");
  let clientBadAuth = null;
  try {
    clientBadAuth = new MemoryToolsClient(HOST, PORT, "bad_user", "bad_pass", CERT_PATH, REJECT_UNAUTHORIZED);
    await clientBadAuth.connect();
    console.error("✖ TEST FAILED: Authentication with incorrect credentials unexpectedly succeeded.");
  } catch (error) {
    console.log(`✔ Success: Authentication failed as expected: ${error.message}`);
  } finally {
    clientBadAuth?.close();
  }

  // --- Main Test Suite with 'admin' User ---
  console.log("\n--- Starting Main Test Suite with 'admin' User ---");
  const client = new MemoryToolsClient(HOST, PORT, ADMIN_USER, ADMIN_PASS, CERT_PATH, REJECT_UNAUTHORIZED);
  const collName = "node_test_collection";

  try {
    await client.connect();
    assert.strictEqual(client.isAuthenticatedSession, true, "Session should be authenticated");
    console.log(`✔ Success: Connected and authenticated as '${client.authenticatedUser}'.`);

    // This inner try/finally ensures the test collection is always cleaned up
    try {
      // --- Collection and Index Lifecycle ---
      console.log("\n--- Testing Collection & Index Lifecycle ---");
      await client.collectionCreate(collName);
      console.log(`✔ Success: Collection '${collName}' created.`);

      let collections = await client.collectionList();
      assert.ok(collections.includes(collName), "Collection should exist in list after creation");
      console.log(`✔ Success: Collection '${collName}' found in list.`);

      await client.collectionIndexCreate(collName, "city");
      console.log("✔ Success: Index on 'city' created.");

      let indexes = await client.collectionIndexList(collName);
      assert.ok(indexes.includes("city"), "Index should exist in list after creation");
      console.log(`✔ Success: Index list verified: [${indexes.join(", ")}]`);

      // --- Item Operations (CRUD) ---
      console.log("\n--- Testing Item CRUD Operations ---");
      const item1 = { _id: "item:1", city: "Madrid", active: true };
      const manyItems = [
        { _id: "item:2", city: "Barcelona", active: true },
        { _id: "item:3", city: "Madrid", active: false },
      ];

      await client.collectionItemSet(collName, item1._id, item1);
      console.log("✔ Success: Set single item.");
      await client.collectionItemSetMany(collName, manyItems);
      console.log("✔ Success: Set many items.");

      const retrieved = await client.collectionItemGet(collName, "item:1");
      assert.deepStrictEqual(retrieved.found, true, "Item 'item:1' should be found.");
      assert.deepStrictEqual(retrieved.value, item1, "Retrieved item 'item:1' should match original.");
      console.log("✔ Success: GET verified item 'item:1'.");

      const notFound = await client.collectionItemGet(collName, "non-existent");
      assert.strictEqual(notFound.found, false, "GET for non-existent key should return found: false.");
      console.log("✔ Success: GET for non-existent item behaved as expected.");

      // --- Update Operations ---
      console.log("\n--- Testing Update Operations ---");
      await client.collectionItemUpdate(collName, "item:1", { active: false });
      console.log("✔ Success: UPDATE single item 'item:1'.");
      const updatedItem1 = await client.collectionItemGet(collName, "item:1");
      assert.strictEqual(updatedItem1.value.active, false, "Single item update was not applied correctly.");
      console.log("✔ Success: Verified single item update.");

      await client.collectionItemUpdateMany(collName, [
        { _id: "item:2", patch: { active: false } },
        { _id: "item:3", patch: { city: "Valencia" } }
      ]);
      console.log("✔ Success: UPDATE MANY items.");
      const updatedItem2 = await client.collectionItemGet(collName, "item:2");
      const updatedItem3 = await client.collectionItemGet(collName, "item:3");
      assert.strictEqual(updatedItem2.value.active, false, "Update many on item:2 failed.");
      assert.strictEqual(updatedItem3.value.city, "Valencia", "Update many on item:3 failed.");
      console.log("✔ Success: Verified many item updates.");

      // --- Query Operations ---
      console.log("\n--- Testing Query Operations ---");
      const queryResult = await client.collectionQuery(collName, {
        filter: { field: "city", op: "=", value: "Madrid" },
      });
      assert.strictEqual(queryResult.length, 1, "Query for city 'Madrid' should return 1 result.");
      assert.strictEqual(queryResult[0]._id, "item:1", "Query result should be 'item:1'.");
      console.log("✔ Success: Filter query returned correct data.");

      const countResult = await client.collectionQuery(collName, { count: true });
      assert.strictEqual(countResult.count, 3, "Count query should return 3.");
      console.log(`✔ Success: Count query returned correct count: ${countResult.count}.`);

      // --- Deletion ---
      await client.collectionItemDelete(collName, "item:1");
      console.log("✔ Success: DELETED single item.");
      const afterDelete = await client.collectionItemGet(collName, "item:1");
      assert.strictEqual(afterDelete.found, false, "Deleted item should not be found.");
      console.log("✔ Success: Verified single item deletion.");


    } finally {
      // --- Final Cleanup ---
      console.log("\n--- Running Final Cleanup ---");
      // Delete remaining items before deleting collection

      // ====================================================================
      // ⬇️⬇️⬇️ INICIO DE LA SECCIÓN AJUSTADA ⬇️⬇️⬇️
      // ====================================================================
      // Use `collectionQuery` to get all remaining items, then map to their keys.
      const allItemsArray = await client.collectionQuery(collName, {});
      const allKeys = allItemsArray.map(item => item._id);
      // ====================================================================
      // ⬆️⬆️⬆️ FIN DE LA SECCIÓN AJUSTADA ⬆️⬆️⬆️
      // ====================================================================

      if (allKeys.length > 0) {
        await client.collectionItemDeleteMany(collName, allKeys);
        console.log(`✔ Success: Deleted remaining ${allKeys.length} items.`);
      }

      const indexes = await client.collectionIndexList(collName);
      if (indexes.includes("city")) {
        await client.collectionIndexDelete(collName, "city");
        console.log("✔ Success: Index 'city' deleted.");
      }

      await client.collectionDelete(collName);
      console.log(`✔ Success: Collection '${collName}' deleted.`);
      const collectionsAfterDelete = await client.collectionList();
      assert.ok(!collectionsAfterDelete.includes(collName), "Collection should not exist after deletion.");
      console.log(`✔ Success: Collection '${collName}' no longer in list.`);
    }
  } catch (error) {
    console.error(`\n--- 💥 UNEXPECTED ERROR DURING TESTS 💥 ---`);
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
    if (error.message.includes("ECONNREFUSED")) {
      console.error("Hint: Is the Go server running? (e.g., `go run .`)");
    }
  } finally {
    console.log("\nClosing connection...");
    client?.close();
    console.log("--- All tests finished ---");
  }
}

// To run this test:
// 1. Start the Go server in a separate terminal: `go run .`
// 2. Run this script: `node test.js`
runTests();
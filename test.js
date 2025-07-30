import { MemoryToolsClient } from "./memory-tools-client.js";

async function runTests() {
  console.log("Starting Memory Tools client tests...");

  // --- Test: Failed Authentication (incorrect user/password) ---
  console.log(
    "\n--- Test: Failed Authentication (incorrect user/password) ---"
  );
  let clientBadAuth = null;
  try {
    clientBadAuth = new MemoryToolsClient(
      "127.0.0.1",
      8080,
      "nonexistent_user",
      "wrongpassword",
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

  // --- Test: Operations with 'admin' User (remote access) ---
  console.log("\n--- Test: Operations with 'admin' User ---");
  let clientAdmin = null;
  try {
    clientAdmin = new MemoryToolsClient(
      "127.0.0.1",
      8080,
      "admin",
      "adminpass", // <-- UPDATE THIS LINE WITH YOUR ACTUAL ADMIN USER PASSWORD!
      null,
      false
    );

    console.log("Attempting to connect and authenticate as 'admin'...");
    await clientAdmin.connect();
    console.log(
      `✔ Success: Connected and authenticated as: ${clientAdmin.getAuthenticatedUsername()}`
    );

    // --- Performing Main Store Operations ---
    console.log("\n--- Performing Main Store Operations as 'admin' ---");

    const testKey = "my_node_key";
    const testValue = {
      data: "Node.js main store test",
      timestamp: Date.now(),
    };
    const updatedValue = { data: "Node.js main store updated", status: "ok" };

    // 1. Set a key-value pair
    await clientAdmin.set(testKey, testValue, 60); // TTL of 60 seconds
    console.log(`✔ Success: Key '${testKey}' set in main store.`);

    // 2. Get the key-value pair
    const retrievedMainItem = await clientAdmin.get(testKey);
    if (
      retrievedMainItem.found &&
      JSON.stringify(retrievedMainItem.value) === JSON.stringify(testValue)
    ) {
      console.log(
        `✔ Success: Key '${testKey}' retrieved from main store:`,
        retrievedMainItem.value
      );
    } else {
      console.log(
        `✖ Error: Failed to retrieve or verify key '${testKey}' from main store.`
      );
    }

    // 3. Update the key-value pair
    await clientAdmin.set(testKey, updatedValue); // No TTL, will use default/no expiry
    console.log(`✔ Success: Key '${testKey}' updated in main store.`);

    const updatedRetrievedMainItem = await clientAdmin.get(testKey);
    if (
      updatedRetrievedMainItem.found &&
      JSON.stringify(updatedRetrievedMainItem.value) ===
        JSON.stringify(updatedValue)
    ) {
      console.log(
        `✔ Success: Key '${testKey}' retrieved after update:`,
        updatedRetrievedMainItem.value
      );
    } else {
      console.log(
        `✖ Error: Failed to retrieve or verify updated key '${testKey}' from main store.`
      );
    }

    // 4. Try to get a non-existent key
    const nonExistentItem = await clientAdmin.get("non_existent_key");
    if (!nonExistentItem.found) {
      console.log(
        `✔ Success: Non-existent key 'non_existent_key' not found as expected.`
      );
    } else {
      console.log(
        `✖ Error: Non-existent key 'non_existent_key' found unexpectedly.`
      );
    }

    // 5. Delete the key-value pair
    await clientAdmin.set(testKey, null, 0); // Setting to null with 0 TTL effectively deletes it
    const deletedItem = await clientAdmin.get(testKey);
    if (!deletedItem.found) {
      console.log(`✔ Success: Key '${testKey}' deleted from main store.`);
    } else {
      console.log(
        `✖ Error: Failed to delete key '${testKey}' from main store.`
      );
    }

    // --- Performing Collection Operations ---
    console.log("\n--- Performing Collection Operations as 'admin' ---");

    const testCollectionName = "my_nodejs_data";
    const itemKey1 = "item_from_node_1";
    const itemValue1 = { message: "Hello from Node.js item 1!" };
    const itemKey2 = "item_from_node_2";
    const itemValue2 = { message: "Hello from Node.js item 2!", version: 2 };
    const itemValue2Updated = { message: "Updated item 2!", version: 2.1 };

    // 1. List collections (before creation)
    const collectionsBeforeCreate = await clientAdmin.collectionList();
    console.log(
      "Available collections (before create):",
      collectionsBeforeCreate.names
    );

    // 2. Create a collection
    await clientAdmin.collectionCreate(testCollectionName);
    console.log(`✔ Success: Collection '${testCollectionName}' created.`);

    // 3. List collections (after creation)
    const collectionsAfterCreate = await clientAdmin.collectionList();
    if (collectionsAfterCreate.names.includes(testCollectionName)) {
      console.log(
        `✔ Success: Collection '${testCollectionName}' found in list after creation.`
      );
    } else {
      console.log(
        `✖ Error: Collection '${testCollectionName}' not found in list after creation.`
      );
    }

    // 4. Set an item in the collection
    await clientAdmin.collectionItemSet(
      testCollectionName,
      itemKey1,
      itemValue1
    );
    console.log(
      `✔ Success: Item '${itemKey1}' set in '${testCollectionName}'.`
    );

    // 5. Set another item in the collection with TTL
    await clientAdmin.collectionItemSet(
      testCollectionName,
      itemKey2,
      itemValue2,
      10
    ); // TTL of 10 seconds
    console.log(
      `✔ Success: Item '${itemKey2}' set in '${testCollectionName}' with TTL.`
    );

    // 6. Get an item from the collection
    const retrievedCollectionItem1 = await clientAdmin.collectionItemGet(
      testCollectionName,
      itemKey1
    );
    if (
      retrievedCollectionItem1.found &&
      JSON.stringify(retrievedCollectionItem1.value) ===
        JSON.stringify(itemValue1)
    ) {
      console.log(
        `✔ Success: Item '${itemKey1}' retrieved from '${testCollectionName}':`,
        retrievedCollectionItem1.value
      );
    } else {
      console.log(
        `✖ Error: Failed to retrieve or verify item '${itemKey1}' from '${testCollectionName}'.`
      );
    }

    // 7. Update an item in the collection
    await clientAdmin.collectionItemSet(
      testCollectionName,
      itemKey2,
      itemValue2Updated
    );
    console.log(
      `✔ Success: Item '${itemKey2}' updated in '${testCollectionName}'.`
    );

    const updatedRetrievedItem2 = await clientAdmin.collectionItemGet(
      testCollectionName,
      itemKey2
    );
    if (
      updatedRetrievedItem2.found &&
      JSON.stringify(updatedRetrievedItem2.value) ===
        JSON.stringify(itemValue2Updated)
    ) {
      console.log(
        `✔ Success: Item '${itemKey2}' retrieved after update:`,
        updatedRetrievedItem2.value
      );
    } else {
      console.log(
        `✖ Error: Failed to retrieve or verify updated item '${itemKey2}' from '${testCollectionName}'.`
      );
    }

    // 8. Try to get a non-existent item from collection
    const nonExistentCollectionItem = await clientAdmin.collectionItemGet(
      testCollectionName,
      "non_existent_item"
    );
    if (!nonExistentCollectionItem.found) {
      console.log(
        `✔ Success: Non-existent item 'non_existent_item' not found as expected in '${testCollectionName}'.`
      );
    } else {
      console.log(
        `✖ Error: Non-existent item 'non_existent_item' found unexpectedly in '${testCollectionName}'.`
      );
    }

    // 9. List items in the collection
    const itemsList = await clientAdmin.collectionItemList(testCollectionName);
    console.log(
      `✔ Success: Items in '${testCollectionName}':`,
      itemsList.items
    );
    if (
      Object.keys(itemsList.items).length === 2 &&
      itemsList.items[itemKey1] &&
      itemsList.items[itemKey2]
    ) {
      console.log(
        `✔ Success: Both expected items '${itemKey1}' and '${itemKey2}' are listed.`
      );
    } else {
      console.log(
        `✖ Error: Item list for '${testCollectionName}' is not as expected.`
      );
    }

    // 10. Test COLLECTION_QUERY
    console.log("\n--- Test: COLLECTION_QUERY ---");
    const queryCollectionName = "users_collection"; // Assuming you have a collection named 'users_collection' with data
    // Populate some test data for query if it doesn't exist
    try {
      await clientAdmin.collectionCreate(queryCollectionName);
      await clientAdmin.collectionItemSet(queryCollectionName, "user_alice", {
        name: "Alice",
        age: 30,
        city: "New York",
      });
      await clientAdmin.collectionItemSet(queryCollectionName, "user_bob", {
        name: "Bob",
        age: 25,
        city: "London",
      });
      await clientAdmin.collectionItemSet(queryCollectionName, "user_charlie", {
        name: "Charlie",
        age: 35,
        city: "New York",
      });
      console.log(`Test data populated for query in '${queryCollectionName}'.`);
    } catch (dataPrepError) {
      console.warn(
        `Warning: Could not prepare query test data for '${queryCollectionName}': ${dataPrepError.message}. Assuming data already exists or query will fail.`
      );
    }

    try {
      // Query for users older than 28, ordered by age descending, limit 2
      const queryResult = await clientAdmin.collectionQuery(
        queryCollectionName,
        {
          filter: { field: "age", op: ">", value: 28 },
          orderBy: [{ field: "age", direction: "desc" }],
          limit: 2,
        }
      );
      console.log(
        `✔ Success: Query results from '${queryCollectionName}':`,
        queryResult
      );
      if (
        queryResult.length === 2 &&
        queryResult[0].age === 35 &&
        queryResult[1].age === 30
      ) {
        console.log("✔ Success: Query result matches expected data and order.");
      } else {
        console.log(
          "✖ Error: Query result did not match expected data or order."
        );
      }

      // Test a count query
      const countQueryResult = await clientAdmin.collectionQuery(
        queryCollectionName,
        {
          count: true,
          filter: { field: "city", op: "=", value: "New York" },
        }
      );
      console.log(
        `✔ Success: Count query for 'New York' users in '${queryCollectionName}':`,
        countQueryResult
      );
      if (countQueryResult.count === 2) {
        console.log("✔ Success: Count query result matches expected count.");
      } else {
        console.log(
          "✖ Error: Count query result did not match expected count."
        );
      }
    } catch (queryError) {
      console.error(
        `✖ Error: Failed to perform collectionQuery on '${queryCollectionName}': ${queryError.message}`
      );
    } finally {
      // Clean up query test data
      try {
        await clientAdmin.collectionDelete(queryCollectionName);
        console.log(
          `✔ Success: Cleaned up query test collection '${queryCollectionName}'.`
        );
      } catch (cleanupError) {
        console.warn(
          `Warning: Failed to clean up query test collection '${queryCollectionName}': ${cleanupError.message}`
        );
      }
    }

    // 11. Delete an item
    await clientAdmin.collectionItemDelete(testCollectionName, itemKey1);
    console.log(
      `✔ Success: Item '${itemKey1}' deleted from '${testCollectionName}'.`
    );

    const remainingItems = await clientAdmin.collectionItemList(
      testCollectionName
    );
    if (
      Object.keys(remainingItems.items).length === 1 &&
      remainingItems.items[itemKey2]
    ) {
      console.log(
        `✔ Success: Only item '${itemKey2}' remains in '${testCollectionName}'.`
      );
    } else {
      console.log(
        `✖ Error: Item '${itemKey1}' was not correctly deleted or other items are missing/present unexpectedly.`
      );
    }

    // 12. Delete the test collection
    await clientAdmin.collectionDelete(testCollectionName);
    console.log(`✔ Success: Collection '${testCollectionName}' deleted.`);

    // 13. List collections (after deletion)
    const collectionsAfterDelete = await clientAdmin.collectionList();
    if (!collectionsAfterDelete.names.includes(testCollectionName)) {
      console.log(
        `✔ Success: Collection '${testCollectionName}' not found in list after deletion.`
      );
    } else {
      console.log(
        `✖ Error: Collection '${testCollectionName}' found in list after deletion unexpectedly.`
      );
    }
  } catch (error) {
    console.error(`\n--- UNEXPECTED ERROR DURING TESTS ---`);
    console.error(`Error: ${error.message}`);
    if (error.message.includes("UNAUTHORIZED: Please authenticate first.")) {
      console.error(
        "Hint: This error indicates the server did not recognize the authentication command or rejected it. Check the CMD_AUTHENTICATE value on both sides (Go and Node.js) and the UserInfo struct in Go for invisible characters."
      );
      console.error(
        "Also ensure your 'admin' user in the Go DB doesn't have 'IsRoot: true' by mistake."
      );
    } else if (
      error.message.includes("CONNECTION REFUSED") ||
      error.message.includes("ECONNREFUSED")
    ) {
      console.error(
        "Hint: Is the MemoryTools Go server running and listening on the specified host and port?"
      );
    }
  } finally {
    console.log("\nClosing connection...");
    clientAdmin?.close();
    console.log("--- All tests finished ---");
  }
}

runTests();

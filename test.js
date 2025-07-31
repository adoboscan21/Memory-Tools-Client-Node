import { MemoryToolsClient } from "./memory-tools-client.js";

async function runTests() {
  console.log("Starting Memory Tools client tests...");

  // --- Test: Failed Authentication (incorrect user/password) ---
  console.log(
    "\n--- Test: Failed Authentication (incorrect user/password) ---"
  );
  let clientBadAuth = null;
  console.time("Auth_Failed"); // Start timer for failed auth
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
    console.timeEnd("Auth_Failed"); // End timer for failed auth
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
    console.time("Admin_ConnectAuth"); // Start timer for admin connect/auth
    await clientAdmin.connect();
    console.timeEnd("Admin_ConnectAuth"); // End timer for admin connect/auth
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
    console.time("MainStore_Set_1");
    await clientAdmin.set(testKey, testValue, 60); // TTL of 60 seconds
    console.timeEnd("MainStore_Set_1");
    console.log(`✔ Success: Key '${testKey}' set in main store.`);

    // 2. Get the key-value pair
    console.time("MainStore_Get_1");
    const retrievedMainItem = await clientAdmin.get(testKey);
    console.timeEnd("MainStore_Get_1");
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
    console.time("MainStore_Set_2_Update");
    await clientAdmin.set(testKey, updatedValue); // No TTL, will use default/no expiry
    console.timeEnd("MainStore_Set_2_Update");
    console.log(`✔ Success: Key '${testKey}' updated in main store.`);

    console.time("MainStore_Get_2_Updated");
    const updatedRetrievedMainItem = await clientAdmin.get(testKey);
    console.timeEnd("MainStore_Get_2_Updated");
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
    console.time("MainStore_Get_NonExistent");
    const nonExistentItem = await clientAdmin.get("non_existent_key");
    console.timeEnd("MainStore_Get_NonExistent");
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
    console.time("MainStore_Delete");
    await clientAdmin.set(testKey, null, 0); // Setting to null with 0 TTL effectively deletes it
    console.timeEnd("MainStore_Delete");

    console.time("MainStore_Get_AfterDelete");
    const deletedItem = await clientAdmin.get(testKey);
    console.timeEnd("MainStore_Get_AfterDelete");
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
    console.time("Collection_List_BeforeCreate");
    const collectionsBeforeCreate = await clientAdmin.collectionList();
    console.timeEnd("Collection_List_BeforeCreate");
    console.log(
      "Available collections (before create):",
      collectionsBeforeCreate.names
    );

    // 2. Create a collection
    console.time("Collection_Create");
    await clientAdmin.collectionCreate(testCollectionName);
    console.timeEnd("Collection_Create");
    console.log(`✔ Success: Collection '${testCollectionName}' created.`);

    // 3. List collections (after creation)
    console.time("Collection_List_AfterCreate");
    const collectionsAfterCreate = await clientAdmin.collectionList();
    console.timeEnd("Collection_List_AfterCreate");
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
    console.time("CollectionItem_Set_1");
    await clientAdmin.collectionItemSet(
      testCollectionName,
      itemKey1,
      itemValue1
    );
    console.timeEnd("CollectionItem_Set_1");
    console.log(
      `✔ Success: Item '${itemKey1}' set in '${testCollectionName}'.`
    );

    // 5. Set another item in the collection with TTL
    console.time("CollectionItem_Set_2_TTL");
    await clientAdmin.collectionItemSet(
      testCollectionName,
      itemKey2,
      itemValue2,
      10
    ); // TTL of 10 seconds
    console.timeEnd("CollectionItem_Set_2_TTL");
    console.log(
      `✔ Success: Item '${itemKey2}' set in '${testCollectionName}' with TTL.`
    );

    // 6. Get an item from the collection
    console.time("CollectionItem_Get_1");
    const retrievedCollectionItem1 = await clientAdmin.collectionItemGet(
      testCollectionName,
      itemKey1
    );
    console.timeEnd("CollectionItem_Get_1");
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
    console.time("CollectionItem_Set_2_Update");
    await clientAdmin.collectionItemSet(
      testCollectionName,
      itemKey2,
      itemValue2Updated
    );
    console.timeEnd("CollectionItem_Set_2_Update");
    console.log(
      `✔ Success: Item '${itemKey2}' updated in '${testCollectionName}'.`
    );

    console.time("CollectionItem_Get_2_Updated");
    const updatedRetrievedItem2 = await clientAdmin.collectionItemGet(
      testCollectionName,
      itemKey2
    );
    console.timeEnd("CollectionItem_Get_2_Updated");
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
    console.time("CollectionItem_Get_NonExistent");
    const nonExistentCollectionItem = await clientAdmin.collectionItemGet(
      testCollectionName,
      "non_existent_item"
    );
    console.timeEnd("CollectionItem_Get_NonExistent");
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
    console.time("CollectionItem_List");
    const itemsList = await clientAdmin.collectionItemList(testCollectionName);
    console.timeEnd("CollectionItem_List");
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

    // --- Test COLLECTION_QUERY ---
    console.log("\n--- Test: COLLECTION_QUERY ---");
    const queryCollectionName = "users";

    // Data preparation (if needed, otherwise ensure 'users' collection is pre-populated)
    // Removed data population from here to avoid re-creating on every run,
    // assuming 'users' collection is already set up from previous steps.

    try {
      // Query 1: Users with email in example.com, ordered by name ASC
      console.time("Query_1_EmailLike");
      let queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
        filter: { field: "email", op: "like", value: "%@example.com" },
        orderBy: [{ field: "name", direction: "asc" }],
      });
      console.timeEnd("Query_1_EmailLike");
      console.log(
        `✔ Success: Query 1 (email like %example.com) results:`,
        queryResult
      );
      const expectedNames1 = [
        "Adonay",
        "David Blanco",
        "Juan Pérez",
        "María García",
        "Sofía Ruiz",
      ];
      if (
        queryResult.length === expectedNames1.length &&
        queryResult.every((u, i) => u.name === expectedNames1[i])
      ) {
        console.log("✔ Success: Query 1 result matches expected data and order.");
      } else {
        console.log("✖ Error: Query 1 result mismatch.");
      }

      // Query 2: Users > 25 years old AND (admin OR moderator role)
      console.time("Query_2_AgeRole");
      queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
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
      console.timeEnd("Query_2_AgeRole");
      console.log(
        `✔ Success: Query 2 (age > 25 AND (admin OR moderator)) results:`,
        queryResult
      );
      const expectedNames2 = [
        "Adonay",
        "Pedro López",
        "Sofía Ruiz",
        "David Blanco",
      ].sort();
      const actualNames2 = queryResult.map((u) => u.name).sort();
      if (
        actualNames2.length === expectedNames2.length &&
        actualNames2.every((name, i) => name === expectedNames2[i])
      ) {
        console.log("✔ Success: Query 2 result matches expected data.");
      } else {
        console.log("✖ Error: Query 2 result mismatch.");
      }

      // Query 3: Count active users
      console.time("Query_3_CountActive");
      const countQueryResult = await clientAdmin.collectionQuery(queryCollectionName, {
        count: true,
        filter: { field: "status", op: "=", value: "active" },
      });
      console.timeEnd("Query_3_CountActive");
      console.log(
        `✔ Success: Query 3 (count active users):`,
        countQueryResult
      );
      if (countQueryResult.count === 8) {
        console.log("✔ Success: Query 3 count matches expected count.");
      } else {
        console.log("✖ Error: Query 3 count mismatch.");
      }

      // Query 4: 5 most recent users (ordered by created_at DESC)
      console.time("Query_4_MostRecent");
      queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
        orderBy: [{ field: "created_at", direction: "desc" }],
        limit: 5,
      });
      console.timeEnd("Query_4_MostRecent");
      console.log(
        `✔ Success: Query 4 (5 most recent users):`,
        queryResult
      );
      const expectedNames4 = [
        "Carlos Sanz",
        "Elena Castro",
        "David Blanco",
        "Sofía Ruiz",
        "Luis García",
      ];
      if (
        queryResult.length === expectedNames4.length &&
        queryResult.every((u, i) => u.name === expectedNames4[i])
      ) {
        console.log("✔ Success: Query 4 result matches expected data and order.");
      } else {
        console.log("✖ Error: Query 4 result mismatch.");
      }

      // Query 5: Users named "Juan" or "María"
      console.time("Query_5_JuanMaria");
      queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
        filter: {
          or: [
            { field: "name", op: "like", value: "%Juan%" },
            { field: "name", op: "like", value: "%María%" },
          ],
        },
      });
      console.timeEnd("Query_5_JuanMaria");
      console.log(
        `✔ Success: Query 5 (name like Juan OR María) results:`,
        queryResult
      );
      const expectedNames5 = ["Juan Pérez", "María García"].sort();
      const actualNames5 = queryResult.map((u) => u.name).sort();
      if (
        actualNames5.length === expectedNames5.length &&
        actualNames5.every((name, i) => name === expectedNames5[i])
      ) {
        console.log("✔ Success: Query 5 result matches expected data.");
      } else {
        console.log("✖ Error: Query 5 result mismatch.");
      }

      // Query 6: Average age per city
      console.time("Query_6_AvgAgePerCity");
      queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
        aggregations: { average_age: { func: "avg", field: "age" } },
        groupBy: ["city"],
      });
      console.timeEnd("Query_6_AvgAgePerCity");
      console.log(
        `✔ Success: Query 6 (average age per city):`,
        queryResult
      );
      if (
        Array.isArray(queryResult) &&
        queryResult.every(
          (item) => item.city && typeof item.average_age === "number"
        )
      ) {
        console.log("✔ Success: Query 6 result structure is as expected.");
      } else {
        console.log("✖ Error: Query 6 result structure mismatch.");
      }

      // Query 7: Users between 25 and 35 (inclusive)
      console.time("Query_7_AgeBetween");
      queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
        filter: { field: "age", op: "between", value: [25, 35] },
      });
      console.timeEnd("Query_7_AgeBetween");
      console.log(
        `✔ Success: Query 7 (age between 25 and 35) results:`,
        queryResult
      );
      const expectedNames7 = [
        "Adonay",
        "Juan Pérez",
        "María García",
        "Ana Díaz",
        "Sofía Ruiz",
        "Elena Castro",
      ].sort();
      const actualNames7 = queryResult.map((u) => u.name).sort();
      if (
        actualNames7.length === expectedNames7.length &&
        actualNames7.every((name, i) => name === expectedNames7[i])
      ) {
        console.log("✔ Success: Query 7 result matches expected data.");
      } else {
        console.log("✖ Error: Query 7 result mismatch.");
      }

      // Query 8: Distinct cities
      console.time("Query_8_DistinctCities");
      queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
        distinct: "city",
      });
      console.timeEnd("Query_8_DistinctCities");
      console.log(`✔ Success: Query 8 (distinct cities):`, queryResult);
      const expectedCities = [
        "Madrid",
        "Barcelona",
        "Valencia",
        "Sevilla",
        "Bilbao",
      ].sort();
      const actualCities = queryResult.sort();
      if (
        actualCities.length === expectedCities.length &&
        actualCities.every((city, i) => city === expectedCities[i])
      ) {
        console.log("✔ Success: Query 8 result matches expected distinct cities.");
      } else {
        console.log("✖ Error: Query 8 result mismatch.");
      }
    } catch (queryError) {
      console.error(
        `✖ Error: Failed to perform collectionQuery on '${queryCollectionName}': ${queryError.message}`
      );
    } finally {
      // Clean up the dynamically created collection for query tests IF it was created here.
      // If you are using your persistent 'users' collection, you might want to remove this block
      // or implement selective cleanup.
      // For this example, I'll keep the cleanup only for 'my_nodejs_data' from earlier tests.
    }


    // 10. Delete an item
    console.time("CollectionItem_Delete");
    await clientAdmin.collectionItemDelete(testCollectionName, itemKey1);
    console.timeEnd("CollectionItem_Delete");
    console.log(
      `✔ Success: Item '${itemKey1}' deleted from '${testCollectionName}'.`
    );

    console.time("CollectionItem_List_AfterDelete");
    const remainingItems = await clientAdmin.collectionItemList(
      testCollectionName
    );
    console.timeEnd("CollectionItem_List_AfterDelete");
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

    // 11. Delete the test collection
    console.time("Collection_Delete");
    await clientAdmin.collectionDelete(testCollectionName);
    console.timeEnd("Collection_Delete");
    console.log(`✔ Success: Collection '${testCollectionName}' deleted.`);

    // 12. List collections (after deletion)
    console.time("Collection_List_AfterDelete");
    const collectionsAfterDelete = await clientAdmin.collectionList();
    console.timeEnd("Collection_List_AfterDelete");
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
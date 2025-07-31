import { MemoryToolsClient } from "../memory-tools-client.js";

async function runTests() {
    console.log("Starting Memory Tools client tests...");

    // --- Test: Failed Authentication (incorrect user/password) ---
    console.log(
        "\n--- Test: Failed Authentication (incorrect user/password) ---"
    );
    let clientBadAuth = null;
    console.time("Auth_Failed");
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
        console.timeEnd("Auth_Failed");
        clientBadAuth?.close();
    }
    
    // --- Test: Operations with 'root' User (localhost only) ---
    console.log("\n--- Test: Operations with 'root' User (localhost only) ---");
    let clientRoot = null;
    try {
        clientRoot = new MemoryToolsClient(
            "127.0.0.1",
            8080,
            "root",
            "rootpass",
            null,
            false
        );
        console.time("Root_ConnectAuth");
        await clientRoot.connect();
        console.timeEnd("Root_ConnectAuth");
        console.log(`✔ Success: Connected and authenticated as: ${clientRoot.getAuthenticatedUsername()}`);
        
        // Test creating the _system collection (should already exist, but verifies permissions)
        console.time("Create_System_Collection");
        const createSystemResponse = await clientRoot.collectionCreate("_system");
        console.timeEnd("Create_System_Collection");
        console.log(`✔ Success: Tried to create _system collection: ${createSystemResponse}`);
    } catch (error) {
        console.error(`✖ Error: Unexpected error during root tests: ${error.message}`);
    } finally {
        clientRoot?.close();
    }


    // --- Test: Operations with 'admin' User (remote access) ---
    console.log("\n--- Test: Operations with 'admin' User ---");
    let clientAdmin = null;
    try {
        clientAdmin = new MemoryToolsClient(
            "127.0.0.1",
            8080,
            "admin",
            "adminpass",
            null,
            false
        );

        console.log("Attempting to connect and authenticate as 'admin'...");
        console.time("Admin_ConnectAuth");
        await clientAdmin.connect();
        console.timeEnd("Admin_ConnectAuth");
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
        await clientAdmin.set(testKey, testValue, 60);
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
        await clientAdmin.set(testKey, updatedValue);
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

        // --- NEW TEST: collection item set many ---
        console.log("\n--- Test: collection item set many ---");
        const manyItems = [
            { name: "Node.js Item A", value: 100, _id: "many_item_a" },
            { name: "Node.js Item B", value: 200, _id: "many_item_b" },
            { name: "Node.js Item C", value: 300, _id: "many_item_c" },
        ];
        console.time("CollectionItem_SetMany");
        await clientAdmin.collectionItemSetMany(testCollectionName, manyItems);
        console.timeEnd("CollectionItem_SetMany");
        console.log(`✔ Success: Set many items into collection '${testCollectionName}'.`);

        console.time("CollectionItem_List_AfterSetMany");
        const allItemsAfterSetMany = await clientAdmin.collectionItemList(testCollectionName);
        console.timeEnd("CollectionItem_List_AfterSetMany");
        const foundKeys = Object.keys(allItemsAfterSetMany.items);
        const expectedKeys = [itemKey1, itemKey2, "many_item_a", "many_item_b", "many_item_c"];
        if (
            foundKeys.length === expectedKeys.length &&
            expectedKeys.every(key => foundKeys.includes(key))
        ) {
            console.log("✔ Success: All expected keys found after set many.");
            console.log(`Items in collection:`, allItemsAfterSetMany.items);
        } else {
            console.log("✖ Error: Keys are missing or unexpected after set many.");
            console.log("Expected:", expectedKeys);
            console.log("Found:", foundKeys);
        }
        
        // --- NEW TEST: collection item delete many ---
        console.log("\n--- Test: collection item delete many ---");
        const keysToDelete = ["many_item_a", "many_item_b"];
        console.time("CollectionItem_DeleteMany");
        await clientAdmin.collectionItemDeleteMany(testCollectionName, keysToDelete);
        console.timeEnd("CollectionItem_DeleteMany");
        console.log(`✔ Success: Deleted multiple items from '${testCollectionName}'.`);

        // Verify that the items are actually deleted
        console.time("CollectionItem_List_AfterDeleteMany");
        const itemsAfterDeleteMany = await clientAdmin.collectionItemList(testCollectionName);
        console.timeEnd("CollectionItem_List_AfterDeleteMany");
        const keysAfterDeleteMany = Object.keys(itemsAfterDeleteMany.items);
        
        // We expect 3 items remaining: itemKey1, itemKey2, and many_item_c
        const expectedKeysAfterDeleteMany = [itemKey1, itemKey2, "many_item_c"];
        if (
            keysAfterDeleteMany.length === 3 &&
            expectedKeysAfterDeleteMany.every(key => keysAfterDeleteMany.includes(key))
        ) {
            console.log(`✔ Success: Items were correctly deleted. Remaining keys:`, keysAfterDeleteMany);
        } else {
            console.log(`✖ Error: Deletion of multiple items failed. Remaining keys:`, keysAfterDeleteMany);
        }
        // --- END NEW TEST ---


        // --- Test COLLECTION_QUERY ---
        console.log("\n--- Test: COLLECTION_QUERY ---");
        const queryCollectionName = "users_test";

        // Data preparation for query test
        console.time("Query_Data_Preparation");
        await clientAdmin.collectionCreate(queryCollectionName);
        const userData = [
            { "_id": "juan_perez", "name": "Juan Pérez", "email": "juan.perez@example.com", "age": 32, "city": "Madrid", "role": "user", "status": "active", "created_at": "2025-07-28T10:00:00Z" },
            { "_id": "maria_garcia", "name": "María García", "email": "maria.garcia@example.com", "age": 28, "city": "Barcelona", "role": "admin", "status": "active", "created_at": "2025-07-28T11:00:00Z" },
            { "_id": "luis_sanchez", "name": "Luis Sánchez", "email": "luis.sanchez@test.com", "age": 45, "city": "Valencia", "role": "user", "status": "inactive", "created_at": "2025-07-28T12:00:00Z" },
            { "_id": "ana_diaz", "name": "Ana Díaz", "email": "ana.diaz@test.com", "age": 25, "city": "Sevilla", "role": "user", "status": "active", "created_at": "2025-07-28T13:00:00Z" },
            { "_id": "pedro_lopez", "name": "Pedro López", "email": "pedro.lopez@outlook.com", "age": 38, "city": "Bilbao", "role": "moderator", "status": "active", "created_at": "2025-07-28T14:00:00Z" },
            { "_id": "sofia_ruiz", "name": "Sofía Ruiz", "email": "sofia.ruiz@example.com", "age": 35, "city": "Madrid", "role": "admin", "status": "active", "created_at": "2025-07-28T15:00:00Z" },
            { "_id": "david_blanco", "name": "David Blanco", "email": "david.blanco@example.com", "age": 40, "city": "Barcelona", "role": "user", "status": "active", "created_at": "2025-07-28T16:00:00Z" },
            { "_id": "elena_castro", "name": "Elena Castro", "email": "elena.castro@test.com", "age": 29, "city": "Valencia", "role": "user", "status": "active", "created_at": "2025-07-28T17:00:00Z" },
            { "_id": "carlos_sanz", "name": "Carlos Sanz", "email": "carlos.sanz@outlook.com", "age": 50, "city": "Sevilla", "role": "user", "status": "active", "created_at": "2025-07-28T18:00:00Z" },
            { "_id": "adonay", "name": "Adonay", "email": "adonay@example.com", "age": 30, "city": "Madrid", "role": "admin", "status": "active", "created_at": "2025-07-28T19:00:00Z" }
        ];
        await clientAdmin.collectionItemSetMany(queryCollectionName, userData);
        console.timeEnd("Query_Data_Preparation");
        console.log(`✔ Success: Data prepared for collection query tests.`);

        try {
            // Query 1: Users with email in example.com, ordered by name ASC
            console.time("Query_1_EmailLike");
            let queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
                filter: { field: "email", op: "like", value: "%@example.com" },
                orderBy: [{ field: "name", direction: "asc" }],
            });
            console.timeEnd("Query_1_EmailLike");
            const expectedNames1 = ["Adonay", "David Blanco", "Juan Pérez", "María García", "Sofía Ruiz"];
            if (
                queryResult.length === expectedNames1.length &&
                queryResult.every((u, i) => u.name === expectedNames1[i])
            ) {
                console.log("✔ Success: Query 1 result matches expected data and order.");
            } else {
                console.log("✖ Error: Query 1 result mismatch.");
                console.log("Result:", queryResult.map(u => u.name));
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
            const expectedNames2 = ["Adonay", "Pedro López", "Sofía Ruiz", "María García", "David Blanco"].sort();
            const actualNames2 = queryResult.map((u) => u.name).sort();
            if (
                actualNames2.length === expectedNames2.length &&
                actualNames2.every((name, i) => name === expectedNames2[i])
            ) {
                console.log("✔ Success: Query 2 result matches expected data.");
            } else {
                console.log("✖ Error: Query 2 result mismatch.");
                console.log("Result:", actualNames2);
            }

            // Query 3: Count active users
            console.time("Query_3_CountActive");
            const countQueryResult = await clientAdmin.collectionQuery(queryCollectionName, {
                count: true,
                filter: { field: "status", op: "=", value: "active" },
            });
            console.timeEnd("Query_3_CountActive");
            if (countQueryResult.count === 9) { // 10 users total, one is inactive
                console.log(`✔ Success: Query 3 count matches expected count (${countQueryResult.count}).`);
            } else {
                console.log(`✖ Error: Query 3 count mismatch. Expected 9, got ${countQueryResult.count}.`);
            }

            // Query 4: 5 most recent users (ordered by created_at DESC)
            console.time("Query_4_MostRecent");
            queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
                orderBy: [{ field: "created_at", direction: "desc" }],
                limit: 5,
            });
            console.timeEnd("Query_4_MostRecent");
            const expectedNames4 = ["Adonay", "Carlos Sanz", "Elena Castro", "David Blanco", "Sofía Ruiz"];
            if (
                queryResult.length === expectedNames4.length &&
                queryResult.every((u, i) => u.name === expectedNames4[i])
            ) {
                console.log("✔ Success: Query 4 result matches expected data and order.");
            } else {
                console.log("✖ Error: Query 4 result mismatch.");
                console.log("Result:", queryResult.map(u => u.name));
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
            const expectedNames5 = ["Juan Pérez", "María García"].sort();
            const actualNames5 = queryResult.map((u) => u.name).sort();
            if (
                actualNames5.length === expectedNames5.length &&
                actualNames5.every((name, i) => name === expectedNames5[i])
            ) {
                console.log("✔ Success: Query 5 result matches expected data.");
            } else {
                console.log("✖ Error: Query 5 result mismatch.");
                console.log("Result:", actualNames5);
            }

            // Query 6: Average age per city
            console.time("Query_6_AvgAgePerCity");
            queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
                aggregations: { average_age: { func: "avg", field: "age" } },
                groupBy: ["city"],
            });
            console.timeEnd("Query_6_AvgAgePerCity");
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
            const expectedNames7 = ["Adonay", "Juan Pérez", "María García", "Ana Díaz", "Sofía Ruiz", "Elena Castro"].sort();
            const actualNames7 = queryResult.map((u) => u.name).sort();
            if (
                actualNames7.length === expectedNames7.length &&
                actualNames7.every((name, i) => name === expectedNames7[i])
            ) {
                console.log("✔ Success: Query 7 result matches expected data.");
            } else {
                console.log("✖ Error: Query 7 result mismatch.");
                console.log("Result:", actualNames7);
            }

            // Query 8: Distinct cities
            console.time("Query_8_DistinctCities");
            queryResult = await clientAdmin.collectionQuery(queryCollectionName, {
                distinct: "city",
            });
            console.timeEnd("Query_8_DistinctCities");
            const expectedCities = ["Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao"].sort();
            const actualCities = queryResult.sort();
            if (
                actualCities.length === expectedCities.length &&
                actualCities.every((city, i) => city === expectedCities[i])
            ) {
                console.log("✔ Success: Query 8 result matches expected distinct cities.");
            } else {
                console.log("✖ Error: Query 8 result mismatch.");
                console.log("Result:", actualCities);
            }
        } catch (queryError) {
            console.error(
                `✖ Error: Failed to perform collectionQuery on '${queryCollectionName}': ${queryError.message}`
            );
        } finally {
            // Clean up the dynamically created collection for query tests
            console.time("Query_Data_Cleanup");
            await clientAdmin.collectionDelete(queryCollectionName);
            console.timeEnd("Query_Data_Cleanup");
            console.log(`✔ Success: Collection '${queryCollectionName}' deleted.`);
        }


        // 10. Delete an item
        console.time("CollectionItem_Delete");
        await clientAdmin.collectionItemDelete(testCollectionName, itemKey1);
        console.timeEnd("CollectionItem_Delete");
        console.log(
            `✔ Success: Item '${itemKey1}' deleted from '${testCollectionName}'.`
        );

        // 11. Delete an item from the set many test
        // NOTE: The previous `setMany` test did not use "explicit_id" as a key. 
        // This deletion attempt will likely fail, which is a valid test case, but let's
        // use an existing key from the `setMany` test to verify the deletion functionality.
        console.time("CollectionItem_Delete_SetMany");
        await clientAdmin.collectionItemDelete(testCollectionName, "many_item_c");
        console.timeEnd("CollectionItem_Delete_SetMany");
        console.log(
            `✔ Success: Item 'many_item_c' deleted from '${testCollectionName}'.`
        );

        console.time("CollectionItem_List_AfterDelete");
        const remainingItems = await clientAdmin.collectionItemList(
            testCollectionName
        );
        console.timeEnd("CollectionItem_List_AfterDelete");
        // The original count was 5 (2 old + 3 new). We deleted many_item_a, many_item_b, item_from_node_1, and now many_item_c.
        // So only `item_from_node_2` should remain.
        const remainingKeys = Object.keys(remainingItems.items);
        if (
            remainingKeys.length === 1 &&
            remainingKeys.includes(itemKey2)
        ) {
            console.log(`✔ Success: Correct number of items remain after deletions.`);
        } else {
            console.log(
                `✖ Error: Incorrect number of items remain after deletions.`
            );
            console.log("Remaining keys:", remainingKeys);
        }


        // 12. Delete the test collection
        console.time("Collection_Delete");
        await clientAdmin.collectionDelete(testCollectionName);
        console.timeEnd("Collection_Delete");
        console.log(`✔ Success: Collection '${testCollectionName}' deleted.`);

        // 13. List collections (after deletion)
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
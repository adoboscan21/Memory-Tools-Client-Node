// memory-tools-client.d.ts
declare module "memory-tools-client" {
  import * as tls from "node:tls";

  // --- Interfaces for results---

  export interface GetResult<T = any> {
    found: boolean;
    message: string;
    value: T | null;
  }

  export interface CollectionListResult {
    message: string;
    names: string[];
  }

  export interface CollectionItemListResult<T = any> {
    message: string;
    items: { [key: string]: T };
  }

  // --- Interfaces for querys ---

  export interface OrderByClause {
    field: string;
    direction: "asc" | "desc";
  }

  export interface Aggregation {
    func: "sum" | "avg" | "min" | "max" | "count";
    field: string;
  }

  export interface Query {
    filter?: { [key: string]: any };
    orderBy?: OrderByClause[];
    limit?: number;
    offset?: number;
    count?: boolean;
    aggregations?: { [key: string]: Aggregation };
    groupBy?: string[];
    having?: { [key: string]: any };
    distinct?: string;
  }

  // --- Principal Class Client ---

  export default class MemoryToolsClient {
    constructor(
      host: string,
      port: number,
      username?: string | null,
      password?: string | null,
      serverCertPath?: string | null,
      rejectUnauthorized?: boolean
    );

    socket: tls.TLSSocket | null;

    connect(): Promise<tls.TLSSocket>;

    close(): void;

    isSessionAuthenticated(): boolean;

    getAuthenticatedUsername(): string | null;

    set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<string>;

    get<T = any>(key: string): Promise<GetResult<T>>;

    collectionCreate(collectionName: string): Promise<string>;

    collectionDelete(collectionName: string): Promise<string>;

    collectionList(): Promise<CollectionListResult>;

    collectionIndexCreate(
      collectionName: string,
      fieldName: string
    ): Promise<string>;

    collectionIndexDelete(
      collectionName: string,
      fieldName: string
    ): Promise<string>;

    collectionIndexList<T = string[]>(collectionName: string): Promise<T>;

    collectionItemSet<T = any>(
      collectionName: string,
      key: string,
      value: T,
      ttlSeconds?: number
    ): Promise<string>;

    collectionItemSetMany<T = any>(
      collectionName: string,
      values: T[]
    ): Promise<string>;

    collectionItemGet<T = any>(
      collectionName: string,
      key: string
    ): Promise<GetResult<T>>;

    collectionItemDelete(collectionName: string, key: string): Promise<string>;

    collectionItemDeleteMany(
      collectionName: string,
      keys: string[]
    ): Promise<string>;

    collectionItemList<T = any>(
      collectionName: string
    ): Promise<CollectionItemListResult<T>>;

    collectionQuery<T = any>(collectionName: string, query: Query): Promise<T>;
  }
}

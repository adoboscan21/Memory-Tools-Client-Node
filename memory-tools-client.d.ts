// dbclient.d.ts
declare module 'memory-tools-client' {
  import { Buffer } from 'node:buffer';
  import * as tls from 'node:tls';
  import * as net from 'node:net';
  import * as fs from 'node:fs';

  interface GetResult {
    found: boolean;
    message: string;
    value: any | null; 
  }

  interface ListCollectionsResult {
    message: string;
    names: string[];
  }

  interface ListItemResult {
    message: string;
    items: { [key: string]: any }; 
  }

  export default class MemoryToolsClient {
    constructor(host: string, port: number, serverCertPath?: string | null, rejectUnauthorized?: boolean);

    connect(): Promise<void>;

    set(key: string, value: any, ttlSeconds?: number): Promise<string>;

    get(key: string): Promise<GetResult>;

    collectionCreate(collectionName: string): Promise<string>;

    collectionDelete(collectionName: string): Promise<string>;

    collectionList(): Promise<ListCollectionsResult>;

    collectionItemSet(collectionName: string, key: string, value: any, ttlSeconds?: number): Promise<string>;

    collectionItemGet(collectionName: string, key: string): Promise<GetResult>;

    collectionItemDelete(collectionName: string, key: string): Promise<string>;

    collectionItemList(collectionName: string): Promise<ListItemResult>;

    socket: tls.TLSSocket | null;
  }
}
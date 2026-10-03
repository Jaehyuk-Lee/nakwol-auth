import type { DataScope } from './domain.ts';

export interface DataEnv { DB: D1Database; AUTH_ORIGIN: string; AUTH_SERVICE: Fetcher; PULL_FEED_SECRET?: string; }
export interface DataPrincipal {
  userId: string;
  clientId: string;
  displayName: string;
  avatarUrl: string | null;
  membershipRole: 'user' | 'member' | 'admin';
}
export interface DataApplicationRow { client_id:string; status:'active'|'disabled'; created_at:number; updated_at:number; }
export interface GameAccountRow { id:string; user_id:string; nickname:string; server_code:string; is_primary:number; created_at:number; updated_at:number; }
export interface RegistryRow { id:string; name:string; metadata_json:string; }
export type { DataScope };

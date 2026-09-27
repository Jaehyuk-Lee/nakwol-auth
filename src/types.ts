export interface Env {
  DB: D1Database;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_BOT_TOKEN?: string;
  NAKWOL_GUILD_ID: string;
  NAKWOL_MEMBER_ROLE_ID?: string;
  NAKWOL_ADMIN_ROLE_ID?: string;
  AUTH_ORIGIN: string;
  COOKIE_SECURE?: string;
}

export interface ApplicationRow {
  client_id: string;
  name: string;
  redirect_uris: string;
  status: string;
}

export interface OAuthRequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  client_state: string | null;
  expires_at: number;
  created_at: number;
}

export interface SessionRow {
  user_id: string;
  expires_at: number;
}

export interface UserRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  status: string;
}

export interface MembershipRow {
  user_id: string;
  guild_id: string;
  is_guild_member: number;
  role: 'user' | 'member' | 'admin';
  status: 'active' | 'inactive';
  checked_at: number;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordGuildMember {
  nick?: string | null;
  avatar?: string | null;
  roles: string[];
}

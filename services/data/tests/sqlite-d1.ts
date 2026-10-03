import { DatabaseSync, StatementSync } from 'node:sqlite';
class BoundStatement {
  private statement: StatementSync; private values: unknown[];
  constructor(statement:StatementSync,values:unknown[]){this.statement=statement;this.values=values;}
  async first<T>():Promise<T|null>{return (this.statement.get(...this.values) as T|undefined)??null;}
  async all<T>():Promise<{results:T[]}>{return {results:this.statement.all(...this.values) as T[]};}
  async run():Promise<unknown>{return this.statement.run(...this.values);}
}
class PreparedStatement {
  private db:DatabaseSync; private sql:string;
  constructor(db:DatabaseSync,sql:string){this.db=db;this.sql=sql;}
  bind(...values:unknown[]){return new BoundStatement(this.db.prepare(this.sql),values);}
  async first<T>():Promise<T|null>{return (this.db.prepare(this.sql).get() as T|undefined)??null;}
  async all<T>():Promise<{results:T[]}>{return {results:this.db.prepare(this.sql).all() as T[]};}
  async run():Promise<unknown>{return this.db.prepare(this.sql).run();}
}
export function createSqliteD1(sql:string){ const db=new DatabaseSync(':memory:'); db.exec(sql); return {raw:db,prepare(query:string){return new PreparedStatement(db,query);},async batch(statements:Array<{run():Promise<unknown>}>){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}}; }

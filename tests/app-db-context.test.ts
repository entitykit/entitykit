import { AppDbContext, Post, User } from '../packages/core/src/examples';
import { setMetadata } from './support/public-api-internals';

describe('example AppDbContext', () => {
    it('exposes configured DbSets and schema script', async () => {
        const db =  AppDbContext.create();

        expect(setMetadata(db.users).ctor).toBe(User);
        expect(setMetadata(db.posts).ctor).toBe(Post);
        expect(db.database.createScript()).toBe([
            'create table if not exists "users" (',
            '  "id" text primary key,',
            '  "email" text not null,',
            '  "name" text not null,',
            '  "created_at" timestamptz not null,',
            '  "updated_at" timestamptz not null',
            ');',
            '',
            'create table if not exists "posts" (',
            '  "id" text primary key,',
            '  "title" text not null,',
            '  "author_id" text not null,',
            '  "created_at" timestamptz not null,',
            '  "updated_at" timestamptz not null',
            ');',
        ].join('\n'));

        await db.dispose();
    });
});

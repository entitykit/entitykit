import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, DeleteBehavior } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class DisplacementAccount {
    public id = '';
    public profile: DisplacementProfile | null = null;
}

class DisplacementProfile {
    public id = '';
    public accountId = '';
    public etag = '';
    public account: DisplacementAccount | null = null;
    public notes: DisplacementNote[] = [];
}

class DisplacementNote {
    public id = '';
    public profileId: string | null = null;
    public profile: DisplacementProfile | null = null;
    public replies: DisplacementReply[] = [];
}

class DisplacementReply {
    public id = '';
    public noteId = '';
    public note: DisplacementNote | null = null;
}

class DisplacementContext extends DbContext {
    public accounts = this.set(DisplacementAccount);
    public profiles = this.set(DisplacementProfile);
    public notes = this.set(DisplacementNote);
    public replies = this.set(DisplacementReply);

    constructor(
        private readonly noteBehavior: DeleteBehavior,
        private readonly optionalNote: boolean,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(DisplacementAccount, entity => {
            entity.toTable('displacement_accounts');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(DisplacementProfile, entity => {
            entity.toTable('displacement_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.accountId).hasColumnName('account_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.etag).hasColumnType('text').isRequired()
                .isConcurrencyToken();
            entity.hasOne(DisplacementAccount, row => row.account)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.accountId)
                .onDelete(DeleteBehavior.Cascade);
        });
        model.entity(DisplacementNote, entity => {
            entity.toTable('displacement_notes');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            const foreignKey = entity.property(row => row.profileId)
                .hasColumnName('profile_id').hasColumnType('text');
            if (this.optionalNote) foreignKey.isOptional();
            else foreignKey.isRequired();
            entity.hasOne(DisplacementProfile, row => row.profile)
                .withMany(row => row.notes)
                .hasForeignKey(row => row.profileId)
                .onDelete(this.noteBehavior);
        });
        model.entity(DisplacementReply, entity => {
            entity.toTable('displacement_replies');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.noteId).hasColumnName('note_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(DisplacementNote, row => row.note)
                .withMany(row => row.replies)
                .hasForeignKey(row => row.noteId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

interface DisplacementGraph {
    readonly db: DisplacementContext;
    readonly incoming: DisplacementProfile;
    readonly occupant: DisplacementProfile;
}

async function graph(
    noteBehavior: DeleteBehavior,
    optionalNote: boolean,
): Promise<DisplacementGraph> {
    const db = DisplacementContext.create(noteBehavior, optionalNote);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into displacement_accounts (id) values (?), (?)',
        values: ['a1', 'a2'],
    });
    await db.database.connection.query({
        text: 'insert into displacement_profiles (id, account_id, etag) ' +
            'values (?, ?, ?), (?, ?, ?)',
        values: ['p1', 'a1', 'v1', 'p2', 'a2', 'v2'],
    });
    await db.database.connection.query({
        text: 'insert into displacement_notes (id, profile_id) values (?, ?)',
        values: ['n2', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into displacement_replies (id, note_id) values (?, ?)',
        values: ['r2', 'n2'],
    });
    const first = Object.assign(new DisplacementAccount(), { id: 'a1' });
    const second = Object.assign(new DisplacementAccount(), { id: 'a2' });
    const incoming = Object.assign(new DisplacementProfile(), {
        id: 'p1', accountId: 'a1', etag: 'v1', account: first,
    });
    const occupant = Object.assign(new DisplacementProfile(), {
        id: 'p2', accountId: 'a2', etag: 'v2', account: second,
    });
    const note = Object.assign(new DisplacementNote(), {
        id: 'n2', profileId: 'p2', profile: occupant,
    });
    const reply = Object.assign(new DisplacementReply(), {
        id: 'r2', noteId: 'n2', note,
    });
    first.profile = incoming;
    second.profile = occupant;
    occupant.notes = [note];
    note.replies = [reply];
    db.accounts.attach(first);
    db.accounts.attach(second);
    db.profiles.attach(incoming);
    db.profiles.attach(occupant);
    db.notes.attach(note);
    db.replies.attach(reply);
    incoming.account = second;
    return { db, incoming, occupant };
}

async function rows(
    db: DisplacementContext,
    table: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
    return (await db.database.connection.query({
        text: `select * from ${table} order by id`, values: [],
    })).rows;
}

describe('one-to-one displacement dependency ordering', () => {
    it('deletes a nested cascade closure before the displaced occupant', async () => {
        const { db } = await graph(DeleteBehavior.Cascade, false);

        await expect(db.saveChanges()).resolves.toBe(4);
        expect(await rows(db, 'displacement_profiles')).toEqual([{
            id: 'p1', account_id: 'a2', etag: 'v1',
        }]);
        expect(await rows(db, 'displacement_notes')).toEqual([]);
        expect(await rows(db, 'displacement_replies')).toEqual([]);
        await db.dispose();
    });

    it('nulls an optional child before deleting the displaced occupant', async () => {
        const { db } = await graph(DeleteBehavior.SetNull, true);

        await expect(db.saveChanges()).resolves.toBe(3);
        expect(await rows(db, 'displacement_profiles')).toEqual([{
            id: 'p1', account_id: 'a2', etag: 'v1',
        }]);
        expect(await rows(db, 'displacement_notes')).toEqual([{
            id: 'n2', profile_id: null,
        }]);
        expect(await rows(db, 'displacement_replies')).toEqual([{
            id: 'r2', note_id: 'n2',
        }]);
        await db.dispose();
    });

    it('preserves the order when the occupant was already deleted', async () => {
        const { db, occupant } = await graph(DeleteBehavior.Cascade, false);
        db.profiles.remove(occupant);

        await expect(db.saveChanges()).resolves.toBe(4);
        expect(await rows(db, 'displacement_profiles')).toEqual([{
            id: 'p1', account_id: 'a2', etag: 'v1',
        }]);
        expect(await rows(db, 'displacement_notes')).toEqual([]);
        expect(await rows(db, 'displacement_replies')).toEqual([]);
        await db.dispose();
    });
});

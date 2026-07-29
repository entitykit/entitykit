import {
    createRelationshipDb,
    OptionalCascadePost,
    RequiredPost,
    RestrictPost,
    User,
} from './support/relationship-model';

describe('scalar foreign-key orphan detection', () => {
    it('deletes a required cascading dependent when its scalar key is cleared', () => {
        const db = createRelationshipDb();
        const user = new User({ id: 'usr_1', cascadePosts: [] });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Scalar orphan',
            authorId: user.id,
            author: user,
        });
        user.cascadePosts.push(post);
        db.users.attach(user);
        db.requiredPosts.attach(post);

        post.authorId = null;
        db.changeTracker.detectChanges();

        expect(db.entry(post)?.state).toBe('Deleted');
        expect(post.author).toBeNull();
        expect(user.cascadePosts).toEqual([]);
    });

    it('rejects clearing a required non-cascading scalar key', () => {
        const db = createRelationshipDb();
        const user = new User({ id: 'usr_1', restrictedPosts: [] });
        const post = new RestrictPost();
        post.id = 'post_1';
        post.authorId = user.id;
        post.author = user;
        user.restrictedPosts.push(post);
        db.users.attach(user);
        db.set(RestrictPost).attach(post);

        (post as { authorId: string | null }).authorId = null;

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('Required relationship \'RestrictPost.author\' was severed');
    });

    it('deletes an optional dependent when its principal uses Cascade', () => {
        const db = createRelationshipDb();
        const user = new User({ id: 'usr_1', optionalCascadePosts: [] });
        const post = new OptionalCascadePost();
        post.id = 'post_1';
        post.authorId = user.id;
        post.author = user;
        user.optionalCascadePosts.push(post);
        db.users.attach(user);
        db.set(OptionalCascadePost).attach(post);

        db.users.remove(user);
        db.changeTracker.detectChanges();

        expect(db.entry(post)?.state).toBe('Deleted');
        expect(post.author).toBeNull();
        expect(user.optionalCascadePosts).toEqual([]);
    });
});

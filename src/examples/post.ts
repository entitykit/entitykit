export class Post {
    public id!: string;
    public title!: string;
    public authorId!: string;
    public createdAt!: Date;
    public updatedAt!: Date;

    constructor(data?: Partial<Post>) {
        Object.assign(this, data);
    }
}

export class User {
    public id!: string;
    public email!: string;
    public name!: string;
    public createdAt!: Date;
    public updatedAt!: Date;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

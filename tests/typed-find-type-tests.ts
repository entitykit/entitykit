import {
    DbContext,
    type DatabaseOperationOptions,
    type DbSet,
} from '../src';

class User {
    public id!: string;
}

class OrderLine {
    public orderId!: string;
    public lineNumber!: number;
}

class TypedKeyContext extends DbContext {
    public users: DbSet<User, [string]> = this.set<User, [string]>(User);
    public orderLines: DbSet<OrderLine, [string, number]> =
        this.set<OrderLine, [string, number]>(OrderLine);
}

declare const context: TypedKeyContext;
declare const options: DatabaseOperationOptions;
void context.users.find('usr_1');
void context.users.find('usr_1', options);
void context.orderLines.find('ord_1', 2);
void context.orderLines.findOrThrow('ord_1', 2, options);
// @ts-expect-error a typed single-column key rejects the wrong value type
void context.users.find(1);
// @ts-expect-error a typed composite key rejects missing key values
void context.orderLines.find('ord_1');
// @ts-expect-error a typed composite key rejects key values in the wrong order
void context.orderLines.find(2, 'ord_1');

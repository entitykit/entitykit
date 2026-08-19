import { CrudAppDbContext } from './crud-app-db-context';
import { Project } from './project';
import { TaskItem } from './task-item';
import { Workspace } from './workspace';

export async function runCrudAppExample(): Promise<void> {
    const db =  CrudAppDbContext.create();

    try {
        db.workspaces.add(new Workspace({
            id: 'wrk_1',
            name: 'Acme',
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        db.projects.add(new Project({
            id: 'prj_1',
            workspaceId: 'wrk_1',
            name: 'Launch',
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        db.tasks.add(new TaskItem({
            id: 'tsk_1',
            workspaceId: 'wrk_1',
            projectId: 'prj_1',
            title: 'Ship EntityKit CRUD sample',
            status: 'todo',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
        }));

        await db.saveChanges();

        const tasks = await db.tasks
            .include(task => task.project)
            .where(task => task.status.ne('done'))
            .orderByDescending(task => task.createdAt)
            .take(20)
            .select(task => ({ id: task.id, title: task.title, status: task.status }))
            .toArray();

        console.log(tasks);
    } finally {
        await db.dispose();
    }
}

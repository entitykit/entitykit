import { createTrialDb } from './support/production-query-trial-context';

describe('production-shaped query trial compilation', () => {
    it('compiles first-class list and export queries from the trial catalog', async () => {
        const db =  createTrialDb();

        try {
            const linksListSql = db.links
                .where(link => link.title.contains('launch'))
                .orderByDescending(link => link.createdAt)
                .take(50)
                .select(link => ({
                    id: link.id,
                    slug: link.slug,
                    title: link.title,
                    url: link.url,
                    createdAt: link.createdAt,
                }))
                .toSql();

            expect(linksListSql.text).toContain('select "id" as "id", "slug" as "slug", "title" as "title", "url" as "url", "created_at" as "createdAt"');
            expect(linksListSql.text).toContain('from "trial_links"');
            expect(linksListSql.text).toContain('"title" like $1');
            expect(linksListSql.text).toContain('"workspace_id" = $2');
            expect(linksListSql.text).toContain('"archived_at" is null');
            expect(linksListSql.values).toEqual(['%launch%', 'wrk_1', 50]);

            const invoiceExportSql = db.invoices
                .where(invoice => invoice.status.in(['open', 'paid']))
                .orderBy(invoice => invoice.dueAt)
                .select(invoice => ({
                    id: invoice.id,
                    status: invoice.status,
                    totalCents: invoice.totalCents,
                    dueAt: invoice.dueAt,
                    paidAt: invoice.paidAt,
                }))
                .toSql();

            expect(invoiceExportSql.text).toContain('from "trial_invoices"');
            expect(invoiceExportSql.text).toContain('"status" in ($1, $2)');
            expect(invoiceExportSql.text).toContain('order by "due_at" asc');
            expect(invoiceExportSql.values).toEqual(['open', 'paid', 'wrk_1']);
        } finally {
            await db.dispose();
        }
    });
});

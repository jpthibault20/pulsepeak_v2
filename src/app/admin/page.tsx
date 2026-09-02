import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin';
import { listAdminUsersAction, getAdminStatsAction } from '@/app/actions/admin';
import { listPromotionsAction } from '@/app/actions/promotions';
import { AdminContent } from './AdminContent';

export const metadata = {
    title: 'Admin',
};

export default async function AdminPage() {
    const allowed = await isAdmin();
    if (!allowed) {
        redirect('/');
    }

    const [users, stats, promotions] = await Promise.all([
        listAdminUsersAction(),
        getAdminStatsAction(),
        listPromotionsAction(),
    ]);

    return (
        <main className="min-h-screen bg-white dark:bg-slate-950">
            <AdminContent initialUsers={users} initialStats={stats} initialPromotions={promotions} />
        </main>
    );
}

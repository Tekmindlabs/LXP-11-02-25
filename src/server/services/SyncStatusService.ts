import { PrismaClient } from "@prisma/client";

export type SyncStatus = 'SYNCED' | 'PENDING' | 'FAILED';
export type EntityType = 'PROGRAM' | 'CLASS_GROUP' | 'CLASS';

export class SyncStatusService {
	constructor(private db: PrismaClient) {}

	async updateSyncStatus(
		entityId: string,
		entityType: EntityType,
		status: SyncStatus,
		error?: string
	) {
		return await this.db.syncStatus.upsert({
			where: { entityId },
			update: {
				status,
				lastSyncAt: new Date(),
				error: error || null,
				retryCount: status === 'FAILED' 
					? { increment: 1 }
					: undefined
			},
			create: {
				entityId,
				entityType,
				status,
				lastSyncAt: new Date(),
				error: error || null,
				retryCount: status === 'FAILED' ? 1 : 0
			}
		});
	}

	async getEntitySyncStatus(entityId: string) {
		return await this.db.syncStatus.findUnique({
			where: { entityId }
		});
	}

	async getFailedSyncs(limit = 50) {
		return await this.db.syncStatus.findMany({
			where: { status: 'FAILED' },
			orderBy: { lastSyncAt: 'desc' },
			take: limit
		});
	}

	async resetRetryCount(entityId: string) {
		return await this.db.syncStatus.update({
			where: { entityId },
			data: { retryCount: 0 }
		});
	}
}
import { PrismaClient } from "@prisma/client";

export type EntityType = 'PROGRAM' | 'CLASS_GROUP' | 'CLASS';
export type ChangeType = 'TERM' | 'ASSESSMENT' | 'CALENDAR';

export class ChangeTrackingService {
	constructor(private db: PrismaClient) {}

	async trackChange(
		entityType: EntityType,
		entityId: string,
		changeType: ChangeType,
		changes: Record<string, any>,
		userId: string
	) {
		return await this.db.changeLog.create({
			data: {
				entityType,
				entityId,
				changeType,
				changes: JSON.stringify(changes),
				userId,
				timestamp: new Date()
			}
		});
	}

	async getChangeHistory(entityId: string, limit = 50) {
		return await this.db.changeLog.findMany({
			where: { entityId },
			orderBy: { timestamp: 'desc' },
			take: limit,
			include: {
				user: {
					select: {
						id: true,
						name: true,
						email: true
					}
				}
			}
		});
	}

	async getRecentChanges(type?: ChangeType, limit = 20) {
		return await this.db.changeLog.findMany({
			where: type ? { changeType: type } : {},
			orderBy: { timestamp: 'desc' },
			take: limit,
			include: {
				user: {
					select: {
						id: true,
						name: true,
						email: true
					}
				}
			}
		});
	}
}
import { PrismaClient } from "@prisma/client";

export type NotificationType = 'TERM_UPDATE' | 'ASSESSMENT_UPDATE' | 'CALENDAR_UPDATE';

export class NotificationService {
	constructor(private db: PrismaClient) {}

	async createUpdateNotification(
		targetId: string,
		type: NotificationType,
		details: Record<string, any>
	) {
		return await this.db.notification.create({
			data: {
				type,
				targetId,
				details: JSON.stringify(details),
				status: 'UNREAD',
				createdAt: new Date()
			}
		});
	}

	async markAsRead(notificationId: string) {
		return await this.db.notification.update({
			where: { id: notificationId },
			data: { status: 'READ', readAt: new Date() }
		});
	}

	async getUnreadNotifications(userId: string) {
		return await this.db.notification.findMany({
			where: {
				OR: [
					{ targetId: userId },
					{ targetUsers: { some: { id: userId } } }
				],
				status: 'UNREAD'
			},
			orderBy: { createdAt: 'desc' }
		});
	}
}
import { PrismaClient, Notification } from "@prisma/client";

export type NotificationType = 
	| 'TERM_UPDATE' 
	| 'ASSESSMENT_UPDATE' 
	| 'CALENDAR_UPDATE' 
	| 'ANNOUNCEMENT' 
	| 'ASSIGNMENT' 
	| 'GRADE' 
	| 'REMINDER' 
	| 'SYSTEM';

export class NotificationService {
	constructor(private db: PrismaClient) {}

	async createUpdateNotification(
		entityId: string,
		type: NotificationType,
		details: Record<string, any>,
		senderId: string,
		title: string
	) {
		return await this.db.notification.create({
			data: {
				type,
				entityId,
				details: JSON.stringify(details),
				title,
				sender: { connect: { id: senderId } },
				status: 'UNREAD'
			}
		});
	}

	async markAsRead(notificationId: string) {
		return await this.db.notification.update({
			where: { id: notificationId },
			data: { 
				readAt: new Date()
			}
		});
	}

	async getUnreadNotifications(userId: string) {
		return await this.db.notification.findMany({
			where: {
				OR: [
					{ recipients: { some: { recipientId: userId, read: false } } }
				],
				status: 'UNREAD'
			},
			include: {
				sender: {
					select: {
						id: true,
						name: true
					}
				}
			},
			orderBy: { createdAt: 'desc' }
		});
	}

	async addRecipients(notificationId: string, recipientIds: string[]) {
		await this.db.notificationRecipient.createMany({
			data: recipientIds.map(recipientId => ({
				notificationId,
				recipientId,
				read: false
			}))
		});
	}
}

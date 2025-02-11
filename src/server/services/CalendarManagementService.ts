import { PrismaClient } from "@prisma/client";
import { NotificationService } from "./NotificationService";

interface CalendarUpdate {
	events: CalendarEvent[];
	scheduleSettings: any;
	lastUpdated?: Date;
}

interface CalendarEvent {
	title: string;
	startDate: Date;
	endDate: Date;
	type: string;
	details: Record<string, any>;
}

export class CalendarManagementService {
	private notificationService: NotificationService;

	constructor(private db: PrismaClient) {
		this.notificationService = new NotificationService(db);
	}

	async cascadeCalendarUpdates(programId: string, updates: CalendarUpdate, systemUserId: string) {
		try {
			// Update program calendar
			const programCalendar = await this.db.programCalendar.update({
				where: { programId },
				data: {
					events: updates.events,
					scheduleSettings: updates.scheduleSettings,
					lastUpdated: new Date()
				}
			});

			// Get all related class groups
			const classGroups = await this.db.classGroup.findMany({
				where: { programId }
			});

			// Cascade to class groups and classes
			for (const group of classGroups) {
				await this.updateClassGroupCalendar(group.id, updates);
				
				const classes = await this.db.class.findMany({
					where: { classGroupId: group.id }
				});

				await Promise.all(classes.map(async (classItem) => {
					await this.updateClassCalendar(classItem.id, updates);
					await this.notificationService.createUpdateNotification(
						classItem.id,
						'CALENDAR_UPDATE',
						{ updatedAt: new Date() },
						systemUserId,
						'Class Calendar Updated'
					);
				}));

				await this.notificationService.createUpdateNotification(
					group.id,
					'CALENDAR_UPDATE',
					{ updatedAt: new Date() },
					systemUserId,
					'Class Group Calendar Updated'
				);
			}

			return programCalendar;
		} catch (error) {
			console.error('Error in cascadeCalendarUpdates:', error);
			throw error;
		}
	}

	private async updateClassGroupCalendar(classGroupId: string, updates: CalendarUpdate) {
		return await this.db.classGroupCalendar.update({
			where: { classGroupId },
			data: {
				events: updates.events,
				scheduleSettings: updates.scheduleSettings,
				lastUpdated: new Date()
			}
		});
	}

	private async updateClassCalendar(classId: string, updates: CalendarUpdate) {
		return await this.db.classCalendar.update({
			where: { classId },
			data: {
				events: updates.events,
				scheduleSettings: updates.scheduleSettings,
				lastUpdated: new Date()
			}
		});
	}
}
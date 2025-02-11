import { PrismaClient } from "@prisma/client";
import { NotificationService } from "./NotificationService";

interface AssessmentUpdate {
	assessmentStructure: any;
	gradingSchema: any;
	lastUpdated?: Date;
}

export class AssessmentManagementService {
	private notificationService: NotificationService;

	constructor(private db: PrismaClient) {
		this.notificationService = new NotificationService(db);
	}

	async cascadeAssessmentUpdates(programId: string, updates: AssessmentUpdate, systemUserId: string) {
		try {
			// Update program assessments
			const programAssessments = await this.db.programAssessmentStructure.update({
				where: { programId },
				data: updates
			});

			// Get all related class groups
			const classGroups = await this.db.classGroup.findMany({
				where: { programId }
			});

			// Cascade to class groups and classes
			for (const group of classGroups) {
				await this.updateClassGroupAssessments(group.id, updates);
				
				const classes = await this.db.class.findMany({
					where: { classGroupId: group.id }
				});

				await Promise.all(classes.map(async (classItem) => {
					await this.updateClassAssessments(classItem.id, updates);
					await this.notificationService.createUpdateNotification(
						classItem.id,
						'ASSESSMENT_UPDATE',
						{ updatedAt: new Date() },
						systemUserId,
						'Class Assessment Settings Updated'
					);
				}));

				await this.notificationService.createUpdateNotification(
					group.id,
					'ASSESSMENT_UPDATE',
					{ updatedAt: new Date() }
				);
			}

			return programAssessments;
		} catch (error) {
			console.error('Error in cascadeAssessmentUpdates:', error);
			throw error;
		}
	}

	private async updateClassGroupAssessments(classGroupId: string, updates: AssessmentUpdate) {
		return await this.db.classGroupAssessmentSettings.update({
			where: { classGroupId },
			data: {
				assessmentStructure: updates.assessmentStructure,
				gradingSchema: updates.gradingSchema,
				lastUpdated: new Date()
			}
		});
	}

	private async updateClassAssessments(classId: string, updates: AssessmentUpdate) {
		return await this.db.classAssessmentSettings.update({
			where: { classId },
			data: {
				assessmentStructure: updates.assessmentStructure,
				gradingSchema: updates.gradingSchema,
				lastUpdated: new Date()
			}
		});
	}
}
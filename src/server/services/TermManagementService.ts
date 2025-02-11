import { PrismaClient } from "@prisma/client";
import type { AcademicTerm, ClassGroupTermSettings } from "@/types/terms";
import { NotificationService } from "./NotificationService";

interface ProgramTermUpdate {
	academicTerms: {
		startDate: Date;
		endDate: Date;
		name: string;
	}[];
	lastUpdated?: Date;
}

export class TermManagementService {
	private notificationService: NotificationService;

	constructor(private db: PrismaClient) {
		this.notificationService = new NotificationService(db);
	}

	async cascadeTermUpdates(programId: string, updates: ProgramTermUpdate) {
		try {
			// 1. Update program terms
			const programTerms = await this.db.programTermStructure.update({
				where: { programId },
				data: updates
			});

			// 2. Get all related class groups
			const classGroups = await this.db.classGroup.findMany({
				where: { programId }
			});

			// 3. Cascade updates to class groups and their classes
			for (const group of classGroups) {
				// Update class group terms
				await this.db.classGroupTermSettings.update({
					where: { classGroupId: group.id },
					data: {
						academicTerms: updates.academicTerms,
						lastUpdated: new Date()
					}
				});

				// Get and update related classes
				const classes = await this.db.class.findMany({
					where: { classGroupId: group.id }
				});

				await Promise.all(classes.map(async (classItem) => {
					await this.db.classTermSettings.update({
						where: { classId: classItem.id },
						data: {
							academicTerms: updates.academicTerms,
							lastUpdated: new Date()
						}
					});

					// Create notification for class update
					await this.notificationService.createUpdateNotification(
						classItem.id,
						'TERM_UPDATE',
						{ updatedAt: new Date() }
					);
				}));

				// Create notification for class group update
				await this.notificationService.createUpdateNotification(
					group.id,
					'TERM_UPDATE',
					{ updatedAt: new Date() }
				);
			}

			return programTerms;
		} catch (error) {
			console.error('Error in cascadeTermUpdates:', error);
			throw error;
		}
	}

	async createProgramTerms(programId: string, academicYearId: string, terms: Omit<AcademicTerm, 'id'>[]) {
		const programTerms = await this.db.programTermStructure.create({
			data: {
				program: { connect: { id: programId } },
				academicYear: { connect: { id: academicYearId } },
				academicTerms: {
					create: terms.map(term => ({
						name: term.name,
						startDate: term.startDate,
						endDate: term.endDate,
						type: term.type,
						calendarTerm: term.calendarTermId ? {
							connect: { id: term.calendarTermId }
						} : undefined,
						assessmentPeriods: {
							create: term.assessmentPeriods.map(ap => ({
								name: ap.name,
								startDate: ap.startDate,
								endDate: ap.endDate,
								weight: ap.weight
							}))
						}
					}))
				}
			},
			include: {
				academicTerms: {
					include: {
						assessmentPeriods: true,
						calendarTerm: true
					}
				}
			}
		});

		const classGroups = await this.db.classGroup.findMany({
			where: { programId }
		});

		await Promise.all(
			classGroups.map(group =>
				this.db.classGroupTermSettings.create({
					data: {
						classGroup: { connect: { id: group.id } },
						programTerm: { connect: { id: programTerms.id } }
					}
				})
			)
		);

		return programTerms;
	}

	async getClassGroupTerms(classGroupId: string) {
		const termSettings = await this.db.classGroupTermSettings.findFirst({
			where: { classGroupId },
			include: {
				programTerm: {
					include: {
						academicTerms: {
							include: {
								assessmentPeriods: true,
								calendarTerm: true
							}
						}
					}
				}
			}
		});

		if (!termSettings) {
			throw new Error("Term settings not found for class group");
		}

		const customSettings = termSettings.customSettings ? 
			JSON.parse(termSettings.customSettings as string) as ClassGroupTermSettings['customSettings'] : 
			undefined;

		return this.mergeTermSettings(
			termSettings.programTerm.academicTerms as unknown as AcademicTerm[],
			customSettings
		);
	}

	async customizeClassGroupTerm(
		classGroupId: string,
		termId: string,
		customSettings: NonNullable<ClassGroupTermSettings['customSettings']>
	) {
		return this.db.classGroupTermSettings.update({
			where: {
				id: termId,
				classGroupId
			},
			data: {
				customSettings: JSON.stringify({
					startDate: customSettings.startDate?.toISOString(),
					endDate: customSettings.endDate?.toISOString(),
					assessmentPeriods: customSettings.assessmentPeriods?.map(ap => ({
						...ap,
						startDate: ap.startDate.toISOString(),
						endDate: ap.endDate.toISOString()
					}))
				})
			}
		});
	}

	private mergeTermSettings(
		baseTerms: AcademicTerm[],
		customSettings?: ClassGroupTermSettings['customSettings']
	): AcademicTerm[] {
		if (!customSettings) return baseTerms;

		return baseTerms.map(term => ({
			...term,
			startDate: customSettings.startDate ? new Date(customSettings.startDate) : term.startDate,
			endDate: customSettings.endDate ? new Date(customSettings.endDate) : term.endDate,
			assessmentPeriods: customSettings.assessmentPeriods?.map(ap => ({
				...ap,
				startDate: new Date(ap.startDate),
				endDate: new Date(ap.endDate)
			})) || term.assessmentPeriods
		}));
	}
}
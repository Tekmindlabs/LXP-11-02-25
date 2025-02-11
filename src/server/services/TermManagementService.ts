import { PrismaClient, Prisma } from "@prisma/client";
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

type SerializedTerm = {
	[key: string]: unknown;
	startDate: string;
	endDate: string;
	name: string;
	weight?: number;
}

type SerializedSettings = {
	[key: string]: unknown;
	startDate: string;
	endDate: string;
	terms: SerializedTerm[];
}

export class TermManagementService {
	private notificationService: NotificationService;

	constructor(private db: PrismaClient) {
		this.notificationService = new NotificationService(db);
	}

	private serializeSettings(updates: ProgramTermUpdate): Prisma.JsonObject {
		return {
			startDate: updates.academicTerms[0]?.startDate.toISOString(),
			endDate: updates.academicTerms[updates.academicTerms.length - 1]?.endDate.toISOString(),
			terms: updates.academicTerms.map(term => ({
				name: term.name,
				startDate: term.startDate.toISOString(),
				endDate: term.endDate.toISOString(),
				weight: 100
			}))
		} as Prisma.JsonObject;
	}

	async cascadeTermUpdates(programId: string, updates: ProgramTermUpdate, systemUserId: string) {
		try {
			// 1. Find the program term structure first
			const existingProgramTerm = await this.db.programTermStructure.findFirst({
				where: { programId },
				include: { academicTerms: true }
			});

			if (!existingProgramTerm) {
				throw new Error(`No program term structure found for program ${programId}`);
			}

			// 2. Update program terms
			const programTerms = await this.db.programTermStructure.update({
				where: { id: existingProgramTerm.id },
				data: {
					academicTerms: {
						updateMany: updates.academicTerms.map((term, index) => ({
							where: { id: existingProgramTerm.academicTerms[index]?.id },
							data: {
								name: term.name,
								startDate: term.startDate,
								endDate: term.endDate,
								updatedAt: new Date()
							}
						}))
					},
					updatedAt: new Date()
				},
				include: {
					academicTerms: true
				}
			});

			// 3. Get all related class groups
			const classGroups = await this.db.classGroup.findMany({
				where: { programId }
			});

			// 4. Cascade updates to class groups
			for (const group of classGroups) {
				const termSettings = await this.db.classGroupTermSettings.findFirst({
					where: {
						classGroupId: group.id,
						programTermId: programTerms.id
					}
				});

				const serializedSettings = this.serializeSettings(updates);


				if (termSettings) {
				  await this.db.classGroupTermSettings.update({
					where: { id: termSettings.id },
					data: {
					  customSettings: serializedSettings,
					  updatedAt: new Date()
					}
				  });
				} else {
				  await this.db.classGroupTermSettings.create({
					data: {
					  classGroup: { connect: { id: group.id } },
					  programTerm: { connect: { id: programTerms.id } },
					  customSettings: serializedSettings
					}
				  });
				}

				// Create notification for class group update
				await this.notificationService.createUpdateNotification(
					group.id,
					'TERM_UPDATE',
					{ updatedAt: new Date() },
					systemUserId,
					'Class Group Term Settings Updated'
				);
			}

			return programTerms;
		} catch (error) {
			console.error('Error in cascadeTermUpdates:', error);
			throw error;
		}
	}

	async getClassGroupTerms(classGroupId: string): Promise<AcademicTerm[]> {
		const termSettings = await this.db.classGroupTermSettings.findFirst({
			where: { classGroupId },
			include: {
				programTerm: {
					include: {
						academicTerms: {
							include: {
								assessmentPeriods: true
							}
						}
					}
				}
			}
		});

		if (!termSettings) {
			throw new Error("Term settings not found for class group");
		}

		const baseTerms: AcademicTerm[] = termSettings.programTerm.academicTerms.map(term => ({
			id: term.id,
			name: term.name,
			type: 'TERM' as const,
			startDate: new Date(term.startDate),
			endDate: new Date(term.endDate),
			assessmentPeriods: term.assessmentPeriods.map(ap => ({

				id: ap.id,
				name: ap.name,
				startDate: ap.startDate,
				endDate: ap.endDate,
				weight: ap.weight
			}))
		}));

		const settings = termSettings.customSettings as Prisma.JsonObject | null;
		if (!settings?.terms) return baseTerms;

		return baseTerms.map((term, index) => {
			const customTerm = (settings.terms as SerializedTerm[])[index];
			if (!customTerm) return term;

			return {
				...term,
				startDate: new Date(customTerm.startDate),
				endDate: new Date(customTerm.endDate),
				name: customTerm.name
			};
		});
	}


	async customizeClassGroupTerm(
		classGroupId: string,
		termId: string,
		customSettings: NonNullable<ClassGroupTermSettings['customSettings']>
	) {
		const serializedSettings: Prisma.JsonObject = {
			startDate: customSettings.startDate?.toISOString() ?? new Date().toISOString(),
			endDate: customSettings.endDate?.toISOString() ?? new Date().toISOString(),
			terms: customSettings.assessmentPeriods?.map(ap => ({
				name: ap.name,
				startDate: ap.startDate.toISOString(),
				endDate: ap.endDate.toISOString(),
				weight: ap.weight
			})) ?? []
		} as Prisma.JsonObject;


		return this.db.classGroupTermSettings.update({
			where: {
				id: termId,
				classGroupId
			},
			data: {
				customSettings: serializedSettings
			}
		});
	}



}

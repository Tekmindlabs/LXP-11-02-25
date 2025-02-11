import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { Prisma, Status, TermSystemType } from "@prisma/client";
import { TermManagementService } from "../../services/TermManagementService";
import { AssessmentManagementService } from "../../services/AssessmentManagementService";
import { CalendarManagementService } from "../../services/CalendarManagementService";
import { ChangeTrackingService } from "../../services/ChangeTrackingService";
import { ErrorRecoveryService } from "../../services/ErrorRecoveryService";

// Define term system input schema
const termSystemInput = z.object({
  type: z.nativeEnum(TermSystemType),
  terms: z.array(z.object({
    name: z.string(),
    startDate: z.date(),
    endDate: z.date(),
    type: z.nativeEnum(TermSystemType),
    assessmentPeriods: z.array(z.object({
      name: z.string(),
      startDate: z.date(),
      endDate: z.date(),
      weight: z.number()
    }))
  }))
});

const includeConfig = {
  coordinator: {
    include: {
      user: true,
    },
  },
  calendar: true,
  classGroups: {
    include: {
      classes: {
        include: {
          students: true,
          teachers: true,
        },
      },
    },
  },
  assessmentSystem: {
    include: {
      markingSchemes: {
        include: {
          gradingScale: true
        }
      },
      rubrics: {
        include: {
          criteria: {
            include: {
              levels: true
            }
          }
        }
      }
    }
  },
  termStructures: {
    include: {
      academicTerms: {
        include: {
          assessmentPeriods: true
        }
      }
    }
  }
};

export const programRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(10),
        search: z.string().optional(),
        status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const where = {
          ...(input.search && {
            OR: [
              { name: { contains: input.search, mode: 'insensitive' as Prisma.QueryMode } },
              { description: { contains: input.search, mode: 'insensitive' as Prisma.QueryMode } },
            ],
          }),
          ...(input.status && { status: input.status }),
        };

        const programs = await ctx.prisma.program.findMany({
          where,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
            include: includeConfig,

          orderBy: {
            name: 'asc',
          },
        });

        const totalCount = await ctx.prisma.program.count({ where });

        return {
          programs,
          pagination: {
            currentPage: input.page,
            pageSize: input.pageSize,
            totalCount,
            totalPages: Math.ceil(totalCount / input.pageSize),
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch programs',
          cause: error,
        });
      }
    }),

  getById: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      try {
        const program = await ctx.prisma.program.findUnique({
          where: { id: input },
          include: {
            coordinator: {
              include: {
                user: true,
              },
            },
            calendar: true,
            classGroups: {
              include: {
                classes: {
                  include: {
                    students: true,
                  },
                },
              },
            },
          },
        });

        if (!program) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Program not found",
          });
        }

        return program;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch program",
          cause: error,
        });
      }
    }),

  getByProgramId: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      try {
        const program = await ctx.prisma.program.findUnique({
          where: { id: input },
          include: {
            coordinator: {
              include: {
                user: true,
              },
            },
            calendar: true,
            classGroups: {
              include: {
                classes: {
                  include: {
                    students: true,
                  },
                },
              },
            },
          },
        });

        if (!program) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Program not found",
          });
        }

        return program;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch program",
          cause: error,
        });
      }
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, "Name is required"),
        description: z.string().optional(),
        calendarId: z.string(),
        coordinatorId: z.string().optional(),
        status: z.nativeEnum(Status).default(Status.ACTIVE),
        termSystem: termSystemInput.optional(),
        assessmentSystem: z.object({
          type: z.enum(["MARKING_SCHEME", "RUBRIC", "HYBRID", "CGPA"]),
          markingScheme: z.object({
          maxMarks: z.number().min(0),
          passingMarks: z.number().min(0),
          gradingScale: z.array(z.object({
            grade: z.string(),
            minPercentage: z.number().min(0).max(100),
            maxPercentage: z.number().min(0).max(100)
          }))
          }).optional(),
          rubric: z.object({
          name: z.string(),
          description: z.string().optional(),
          criteria: z.array(z.object({
            name: z.string(),
            description: z.string().optional(),
            levels: z.array(z.object({
            name: z.string(),
            points: z.number().min(0),
            description: z.string().optional()
            }))
          }))
          }).optional(),
          cgpaConfig: z.object({
          gradePoints: z.array(z.object({
            grade: z.string(),
            points: z.number(),
            minPercentage: z.number().min(0).max(100),
            maxPercentage: z.number().min(0).max(100)
          })),
          semesterWeightage: z.boolean(),
          includeBacklogs: z.boolean()
          }).optional()
        }).optional()
      })
    )

    .mutation(async ({ ctx, input }) => {
      try {
        // Fetch calendar and ensure it has an academic year and terms
        const calendar = await ctx.prisma.calendar.findUnique({
          where: { id: input.calendarId },
          include: { academicYear: true, terms: true }
        });

        if (!calendar?.academicYear?.id || !calendar.terms[0]?.id) {
          throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Calendar must have an academic year and at least one term",
          });
        }

        const academicYearId = calendar.academicYear.id;
        const termId = calendar.terms[0].id;

        // Validate coordinator if provided
        if (input.coordinatorId) {
          const coordinator = await ctx.prisma.coordinatorProfile.findUnique({
          where: { id: input.coordinatorId },
          });

          if (!coordinator) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Coordinator not found",
          });
          }
        }

        // Create program with all relationships
        const program = await ctx.prisma.program.create({
          data: {
            name: input.name,
            description: input.description,
            calendar: { connect: { id: input.calendarId } },
            coordinator: input.coordinatorId ? { connect: { id: input.coordinatorId } } : undefined,
            status: input.status,
            termSystem: input.termSystem?.type,
            termStructures: input.termSystem ? {
              create: input.termSystem.terms.map((term, index) => ({
              name: term.name,
              startDate: term.startDate,
              endDate: term.endDate,
              order: index + 1,
              weight: 1.0,
              status: Status.ACTIVE,
              academicYear: { connect: { id: academicYearId } },
              academicTerms: {
                create: {
                name: term.name,
                status: Status.ACTIVE,
                assessmentWeightage: 100,
                term: { connect: { id: termId } },
                assessmentPeriods: {
                  create: term.assessmentPeriods
                }
                }
              }
              }))
            } : undefined,

            ...(input.assessmentSystem && {
            assessmentSystem: input.assessmentSystem ? {
              create: {
              name: input.name + " Assessment System",
              type: input.assessmentSystem.type,
              markingSchemes: input.assessmentSystem.markingScheme ? {
                create: {
                name: "Default Marking Scheme",
                maxMarks: input.assessmentSystem.markingScheme.maxMarks,
                passingMarks: input.assessmentSystem.markingScheme.passingMarks,
                gradingScale: {
                  createMany: {
                  data: input.assessmentSystem.markingScheme.gradingScale
                  }
                }
                }
              } : undefined,
              rubrics: input.assessmentSystem.rubric ? {
                create: {
                name: input.assessmentSystem.rubric.name,
                description: input.assessmentSystem.rubric.description,
                criteria: {
                  create: input.assessmentSystem.rubric.criteria.map(criterion => ({
                  name: criterion.name,
                  description: criterion.description,
                  levels: {
                    createMany: {
                    data: criterion.levels
                    }
                  }
                  }))
                }
                }
              } : undefined
              }
            } : undefined


            })
          },
          include: includeConfig
        });

        return program;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create program",
          cause: error,
        });
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        calendarId: z.string().optional(),
        coordinatorId: z.string().optional(),
        status: z.nativeEnum(Status).optional(),
        termSystem: termSystemInput.optional(),
        assessmentSystem: z.object({
          type: z.enum(["MARKING_SCHEME", "RUBRIC", "HYBRID", "CGPA"]),
          markingScheme: z.object({
            maxMarks: z.number().min(0),
            passingMarks: z.number().min(0),
            gradingScale: z.array(z.object({
              grade: z.string(),
              minPercentage: z.number().min(0).max(100),
              maxPercentage: z.number().min(0).max(100)
            }))
          }).optional(),
          rubric: z.object({
            name: z.string(),
            description: z.string().optional(),
            criteria: z.array(z.object({
              name: z.string(),
              description: z.string().optional(),
              levels: z.array(z.object({
                name: z.string(),
                points: z.number().min(0),
                description: z.string().optional()
              }))
            }))
          }).optional()
        }).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Fetch existing program with necessary includes
        const existingProgram = await ctx.prisma.program.findUnique({
          where: { id: input.id },
          include: {
            calendar: {
              include: {
                academicYear: true,
                terms: true
              }
            }
          }
        });

        if (!existingProgram) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Program not found",
          });
        }

        if (!existingProgram?.calendar?.academicYear?.id || !existingProgram.calendar.terms[0]?.id) {
          throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Program calendar must have an academic year and at least one term",
          });
        }

        const existingAcademicYearId = existingProgram.calendar.academicYear.id;
        const existingTermId = existingProgram.calendar.terms[0].id;

        // Validate coordinator if provided
        if (input.coordinatorId) {
          const coordinator = await ctx.prisma.coordinatorProfile.findUnique({
            where: { id: input.coordinatorId },
          });

          if (!coordinator) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Coordinator not found",
            });
          }
        }

        // Update program data
        const updatedProgram = await ctx.prisma.program.update({
          where: { id: input.id },
          data: {
            name: input.name,
            description: input.description,
            calendar: input.calendarId ? { connect: { id: input.calendarId } } : undefined,
            coordinator: input.coordinatorId ? { connect: { id: input.coordinatorId } } : undefined,
            status: input.status,
            termSystem: input.termSystem?.type,
            termStructures: input.termSystem ? {
              deleteMany: {},
              create: input.termSystem.terms.map((term, index) => ({
              name: term.name,
              startDate: term.startDate,
              endDate: term.endDate,
              order: index + 1,
              weight: 1.0,
              status: Status.ACTIVE,
              academicYear: { connect: { id: existingAcademicYearId } },
              academicTerms: {
                create: {
                name: term.name,
                status: Status.ACTIVE,
                assessmentWeightage: 100,
                term: { connect: { id: existingTermId } },
                assessmentPeriods: {
                  create: term.assessmentPeriods
                }
                }
              }
              }))

            } : undefined,
            assessmentSystem: input.assessmentSystem ? {
              update: {
              type: input.assessmentSystem.type,
              markingSchemes: input.assessmentSystem.markingScheme ? {
                deleteMany: {},
                create: [{
                name: "Updated Marking Scheme",
                maxMarks: input.assessmentSystem.markingScheme.maxMarks,
                passingMarks: input.assessmentSystem.markingScheme.passingMarks,
                gradingScale: {
                  createMany: {
                  data: input.assessmentSystem.markingScheme.gradingScale
                  }
                }
                }]
              } : undefined,
              rubrics: input.assessmentSystem.rubric ? {
                deleteMany: {},
                create: [{
                name: input.assessmentSystem.rubric.name,
                description: input.assessmentSystem.rubric.description,
                criteria: {
                  create: input.assessmentSystem.rubric.criteria.map(criterion => ({
                  name: criterion.name,
                  description: criterion.description,
                  levels: {
                    createMany: {
                    data: criterion.levels
                    }
                  }
                  }))
                }
                }]
              } : undefined
              }
            } : undefined


          },
          include: includeConfig
        });

        return updatedProgram;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update program",
          cause: error,
        });
      }
    }),


  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      try {
        const program = await ctx.prisma.program.delete({
          where: { id: input },
        });

        return program;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete program",
          cause: error,
        });
      }
    }),

  getAvailableCoordinators: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const coordinators = await ctx.prisma.coordinatorProfile.findMany({
          include: {
            user: true,
          },
        });

        return coordinators;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch available coordinators',
          cause: error,
        });
      }
    }),


  associateCalendar: protectedProcedure
    .input(
      z.object({
        programId: z.string(),
        calendarId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const program = await ctx.prisma.program.update({
          where: { id: input.programId },
          data: {
            calendar: {
              connect: { id: input.calendarId },
            },
          },
          include: {
            coordinator: {
              include: {
                user: true,
              },
            },
            calendar: true,
            classGroups: {
              include: {
                classes: {
                  include: {
                    students: true,
                    teachers: true,
                  },
                },
              },
            },
          },
        });

        return program;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to associate calendar',
          cause: error,
        });
      }
    }),

  getCalendarSettings: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      try {
        const calendar = await ctx.prisma.calendar.findUnique({
          where: { id: input },
          include: { 
            terms: true,
            events: true
          }
        });

        if (!calendar) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Calendar not found",
          });
        }

        return calendar;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch calendar settings",
          cause: error,
        });
      }
    }),

  searchPrograms: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      try {
        const programs = await ctx.prisma.program.findMany({
          where: {
            OR: [
              { name: { contains: input, mode: 'insensitive' as Prisma.QueryMode } },
              { description: { contains: input, mode: 'insensitive' as Prisma.QueryMode } },
            ],
          },
          take: 10,
          include: {
            coordinator: {
              include: {
                user: true,
              },
            },
            calendar: true,
          },
        });

        return programs;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to search programs',
          cause: error,
        });
      }
    }),

    updateTerms: protectedProcedure
    .input(z.object({
      programId: z.string(),
      updates: z.object({
      academicTerms: z.array(z.object({
        startDate: z.date(),
        endDate: z.date(),
        name: z.string()
      }))
      })
    }))
    .mutation(async ({ ctx, input }) => {
      const termService = new TermManagementService(ctx.prisma);
      const changeTracker = new ChangeTrackingService(ctx.prisma);
      const errorRecovery = new ErrorRecoveryService(ctx.prisma);

      try {
      const result = await termService.cascadeTermUpdates(
        input.programId,
        input.updates
      );

      await changeTracker.trackChange(
        'PROGRAM',
        input.programId,
        'TERM',
        input.updates,
        ctx.session.user.id
      );

      return result;
      } catch (error) {
      if (error instanceof Error) {
        await errorRecovery.handleFailedSync(input.programId, error);
      }
      throw error;
      }
    }),

    updateAssessments: protectedProcedure
    .input(z.object({
      programId: z.string(),
      updates: z.object({
      assessmentStructure: z.any(),
      gradingSchema: z.any()
      })
    }))
    .mutation(async ({ ctx, input }) => {
      const assessmentService = new AssessmentManagementService(ctx.prisma);
      const changeTracker = new ChangeTrackingService(ctx.prisma);
      const errorRecovery = new ErrorRecoveryService(ctx.prisma);

      try {
      const result = await assessmentService.cascadeAssessmentUpdates(
        input.programId,
        input.updates
      );

      await changeTracker.trackChange(
        'PROGRAM',
        input.programId,
        'ASSESSMENT',
        input.updates,
        ctx.session.user.id
      );

      return result;
      } catch (error) {
      if (error instanceof Error) {
        await errorRecovery.handleFailedSync(input.programId, error);
      }
      throw error;
      }
    }),

    updateCalendar: protectedProcedure
    .input(z.object({
      programId: z.string(),
      updates: z.object({
      events: z.array(z.object({
        title: z.string(),
        startDate: z.date(),
        endDate: z.date(),
        type: z.string(),
        details: z.record(z.any())
      })),
      scheduleSettings: z.any()
      })
    }))
    .mutation(async ({ ctx, input }) => {
      const calendarService = new CalendarManagementService(ctx.prisma);
      const changeTracker = new ChangeTrackingService(ctx.prisma);
      const errorRecovery = new ErrorRecoveryService(ctx.prisma);

      try {
      const result = await calendarService.cascadeCalendarUpdates(
        input.programId,
        input.updates
      );

      await changeTracker.trackChange(
        'PROGRAM',
        input.programId,
        'CALENDAR',
        input.updates,
        ctx.session.user.id
      );

      return result;
      } catch (error) {
      if (error instanceof Error) {
        await errorRecovery.handleFailedSync(input.programId, error);
      }
      throw error;
      }
    })
  });

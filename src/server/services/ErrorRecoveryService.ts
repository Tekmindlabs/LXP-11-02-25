import { PrismaClient } from "@prisma/client";
import { SyncStatusService } from "./SyncStatusService";
import { NotificationService } from "./NotificationService";

interface RetryConfig {
	maxRetries: number;
	backoffInterval: number; // in milliseconds
}

export class ErrorRecoveryService {
	private syncStatusService: SyncStatusService;
	private notificationService: NotificationService;

	constructor(
		private db: PrismaClient,
		private config: RetryConfig = { maxRetries: 3, backoffInterval: 5000 }
	) {
		this.syncStatusService = new SyncStatusService(db);
		this.notificationService = new NotificationService(db);
	}

	async handleFailedSync(entityId: string, error: Error) {
		// Log error details
		await this.logError(entityId, error);

		// Get current sync status
		const syncStatus = await this.syncStatusService.getEntitySyncStatus(entityId);

		if (syncStatus && syncStatus.retryCount < this.config.maxRetries) {
			// Schedule retry with exponential backoff
			await this.scheduleRetry(entityId, syncStatus.retryCount);
		} else {
			// Mark as permanently failed and notify administrators
			await this.markPermanentFailure(entityId, error);
		}
	}

	private async logError(entityId: string, error: Error) {
		await this.db.errorLog.create({
			data: {
				entityId,
				errorMessage: error.message,
				stackTrace: error.stack,
				timestamp: new Date()
			}
		});
	}

	private async scheduleRetry(entityId: string, currentRetryCount: number) {
		const backoffTime = this.config.backoffInterval * Math.pow(2, currentRetryCount);
		
		// Update sync status to pending
		await this.syncStatusService.updateSyncStatus(
			entityId,
			'PROGRAM', // Default to PROGRAM, should be determined based on entity
			'PENDING'
		);

		// Schedule retry after backoff
		setTimeout(async () => {
			try {
				await this.performRetry(entityId);
			} catch (error) {
				if (error instanceof Error) {
					await this.handleFailedSync(entityId, error);
				}
			}
		}, backoffTime);
	}

	private async markPermanentFailure(entityId: string, error: Error) {
		await this.syncStatusService.updateSyncStatus(
			entityId,
			'PROGRAM', // Default to PROGRAM, should be determined based on entity
			'FAILED',
			error.message
		);

		// Notify administrators
		await this.notificationService.createUpdateNotification(
			entityId,
			'TERM_UPDATE',
			{
				status: 'PERMANENT_FAILURE',
				error: error.message,
				timestamp: new Date()
			}
		);
	}

	private async performRetry(entityId: string) {
		// Implement retry logic based on entity type and required updates
		// This should be implemented based on specific requirements
	}
}
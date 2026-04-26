/**
 * User statistics summary
 */
export interface UserStatistics {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  anonymizedUsers: number;
  adminUsers: number;
  recentUsers: number;
}

/**
 * Interface for user statistics operations
 * Handles user count and analytics queries
 */
export interface IUserStatisticsService {
  countTotalUsers(): Promise<number>;
  countActiveUsers(): Promise<number>;
  countDisabledUsers(): Promise<number>;
  countAnonymizedUsers(): Promise<number>;
  countAdminUsers(): Promise<number>;
  countRecentUsers(days?: number): Promise<number>;
  getUserStatistics(): Promise<UserStatistics>;
}

import { BaseClient } from './base.js';
import type { Tweet, PaginatedResult } from '../../types/twitter.js';

export class TimelineMixin extends BaseClient {
  async getHomeTimeline(count = 20, cursor?: string): Promise<PaginatedResult<Tweet>> {
    const data = await this.graphql<any>('HomeTimeline', {
      count,
      cursor,
      includePromotedContent: false,
      latestControlAvailable: true,
      requestContext: 'launch',
    });

    return this.parseTimeline(data);
  }

  async getHomeLatestTimeline(count = 20, cursor?: string): Promise<PaginatedResult<Tweet>> {
    const data = await this.graphql<any>('HomeLatestTimeline', {
      count,
      cursor,
      includePromotedContent: false,
      latestControlAvailable: true,
    });

    return this.parseTimeline(data);
  }

  async getBookmarks(count = 20, cursor?: string): Promise<PaginatedResult<Tweet>> {
    const data = await this.graphql<any>('Bookmarks', {
      count,
      cursor,
      includePromotedContent: false,
    });

    return this.parseBookmarks(data);
  }

  async getLikes(userId: string, count = 20, cursor?: string): Promise<PaginatedResult<Tweet>> {
    const data = await this.graphql<any>('Likes', {
      userId,
      count,
      cursor,
      includePromotedContent: false,
    });

    return this.parseLikes(data);
  }

  private parseTimeline(data: any): PaginatedResult<Tweet> {
    const instructions = data?.home?.home_timeline_urt?.instructions || [];
    const entries = instructions
      .find((i: any) => i.type === 'TimelineAddEntries')
      ?.entries || [];

    const tweets: Tweet[] = [];
    let cursor: string | undefined;

    for (const entry of entries) {
      if (entry.content?.itemContent?.tweet_results?.result) {
        try {
          tweets.push(this.parseTweetFromTimeline(entry.content.itemContent.tweet_results.result));
        } catch (e) {
          // Skip unavailable tweets
        }
      }
      if (entry.content?.cursorType === 'Bottom') {
        cursor = entry.content.value;
      }
    }

    return {
      items: tweets,
      cursor,
      hasMore: !!cursor,
    };
  }

  private parseBookmarks(data: any): PaginatedResult<Tweet> {
    const instructions = data?.bookmark_timeline_v2?.timeline?.instructions || [];
    const entries = instructions
      .find((i: any) => i.type === 'TimelineAddEntries')
      ?.entries || [];

    const tweets: Tweet[] = [];
    let cursor: string | undefined;

    for (const entry of entries) {
      if (entry.content?.itemContent?.tweet_results?.result) {
        try {
          tweets.push(this.parseTweetFromTimeline(entry.content.itemContent.tweet_results.result));
        } catch (e) {
          // Skip unavailable tweets
        }
      }
      if (entry.content?.cursorType === 'Bottom') {
        cursor = entry.content.value;
      }
    }

    return {
      items: tweets,
      cursor,
      hasMore: !!cursor,
    };
  }

  private parseLikes(data: any): PaginatedResult<Tweet> {
    const instructions = data?.user?.result?.timeline_v2?.timeline?.instructions || [];
    const entries = instructions
      .find((i: any) => i.type === 'TimelineAddEntries')
      ?.entries || [];

    const tweets: Tweet[] = [];
    let cursor: string | undefined;

    for (const entry of entries) {
      if (entry.content?.itemContent?.tweet_results?.result) {
        try {
          tweets.push(this.parseTweetFromTimeline(entry.content.itemContent.tweet_results.result));
        } catch (e) {
          // Skip unavailable tweets
        }
      }
      if (entry.content?.cursorType === 'Bottom') {
        cursor = entry.content.value;
      }
    }

    return {
      items: tweets,
      cursor,
      hasMore: !!cursor,
    };
  }

  private parseTweetFromTimeline(result: any): Tweet {
    const tweetData = result.tweet || result;
    const legacy = tweetData.legacy;
    const core = tweetData.core?.user_results?.result;

    return {
      id: tweetData.rest_id,
      text: this.extractTweetText(tweetData),
      createdAt: legacy.created_at,
      user: core ? {
        id: core.id,
        restId: core.rest_id,
        name: core.legacy.name,
        screenName: core.legacy.screen_name,
        profileImageUrl: core.legacy.profile_image_url_https,
        verified: core.legacy.verified,
        isBlueVerified: core.is_blue_verified || false,
      } : null as any,
      replyCount: legacy.reply_count,
      retweetCount: legacy.retweet_count,
      likeCount: legacy.favorite_count,
      quoteCount: legacy.quote_count,
      viewCount: tweetData.views?.count ? parseInt(tweetData.views.count) : undefined,
      bookmarkCount: legacy.bookmark_count,
      isRetweet: !!legacy.retweeted_status_result,
      isQuote: !!legacy.is_quote_status,
      isReply: !!legacy.in_reply_to_status_id_str,
      inReplyToTweetId: legacy.in_reply_to_status_id_str,
      inReplyToUserId: legacy.in_reply_to_user_id_str,
      conversationId: legacy.conversation_id_str,
      lang: legacy.lang,
    };
  }
}

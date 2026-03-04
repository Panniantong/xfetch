import { BaseClient } from './base.js';
import type { Tweet, TwitterList, PaginatedResult } from '../../types/twitter.js';

// Feature flags for list endpoints
const LIST_FEATURES = {
  rweb_video_screen_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
};

export class ListMixin extends BaseClient {
  /**
   * Get a list by its ID
   */
  async getList(listId: string): Promise<TwitterList> {
    const data = await this.graphql<any>('ListByRestId', {
      listId,
    }, LIST_FEATURES);

    const result = data?.list;
    if (!result) {
      throw new Error(`List not found: ${listId}`);
    }

    return this.parseList(result);
  }

  /**
   * Get lists owned by a user
   */
  async getUserLists(userId: string, count = 100): Promise<PaginatedResult<TwitterList>> {
    const data = await this.graphql<any>('ListOwnerships', {
      userId,
      count,
      isListMembershipShown: true,
    }, LIST_FEATURES);

    return this.parseListResult(data);
  }

  /**
   * Get members of a list
   */
  async getListMembers(listId: string, count = 20, cursor?: string): Promise<PaginatedResult<any>> {
    const data = await this.graphql<any>('ListMembers', {
      listId,
      count,
      cursor,
    }, LIST_FEATURES);

    return this.parseListMembers(data);
  }

  /**
   * Get tweets from a list timeline
   */
  async getListTweets(listId: string, count = 20, cursor?: string): Promise<PaginatedResult<Tweet>> {
    const data = await this.graphql<any>('ListLatestTweetsTimeline', {
      listId,
      count,
      cursor,
    }, LIST_FEATURES);

    return this.parseListTweets(data);
  }

  private parseList(result: any): TwitterList {
    const owner = result.user_results?.result;
    
    return {
      id: result.id_str,
      name: result.name,
      description: result.description,
      memberCount: result.member_count || 0,
      subscriberCount: result.subscriber_count || 0,
      isPrivate: result.mode?.toLowerCase() === 'private',
      createdAt: result.created_at,
      owner: owner ? {
        id: owner.rest_id,
        screenName: owner.legacy?.screen_name,
        name: owner.legacy?.name,
      } : undefined,
    };
  }

  private parseListResult(data: any): PaginatedResult<TwitterList> {
    const instructions = data?.user?.result?.timeline?.timeline?.instructions || [];
    const entries = instructions
      .flatMap((i: any) => i.entries || []);

    const lists: TwitterList[] = [];
    let cursor: string | undefined;

    for (const entry of entries) {
      if (entry.content?.itemContent?.list) {
        lists.push(this.parseList(entry.content.itemContent.list));
      }
      if (entry.content?.cursorType === 'Bottom') {
        cursor = entry.content.value;
      }
    }

    return {
      items: lists,
      cursor,
      hasMore: !!cursor,
    };
  }

  private parseListMembers(data: any): PaginatedResult<any> {
    const instructions = data?.list?.members_timeline?.timeline?.instructions || [];
    const entries = instructions
      .flatMap((i: any) => i.entries || []);

    const members: any[] = [];
    let cursor: string | undefined;

    for (const entry of entries) {
      if (entry.content?.itemContent?.user_results?.result) {
        const user = entry.content.itemContent.user_results.result;
        const legacy = user.legacy;
        members.push({
          id: user.id,
          restId: user.rest_id,
          name: legacy.name,
          screenName: legacy.screen_name,
          description: legacy.description,
          followersCount: legacy.followers_count,
          followingCount: legacy.friends_count,
          profileImageUrl: legacy.profile_image_url_https,
          verified: legacy.verified,
          isBlueVerified: user.is_blue_verified || false,
        });
      }
      if (entry.content?.cursorType === 'Bottom') {
        cursor = entry.content.value;
      }
    }

    return {
      items: members,
      cursor,
      hasMore: !!cursor,
    };
  }

  private parseListTweets(data: any): PaginatedResult<Tweet> {
    const instructions = data?.list?.tweets_timeline?.timeline?.instructions || [];
    const entries = instructions
      .flatMap((i: any) => i.entries || []);

    const tweets: Tweet[] = [];
    let cursor: string | undefined;

    for (const entry of entries) {
      if (entry.content?.itemContent?.tweet_results?.result) {
        try {
          tweets.push(this.parseTweetFromList(entry.content.itemContent.tweet_results.result));
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

  private parseTweetFromList(result: any): Tweet {
    // Handle tombstones and unavailable tweets
    if (result.__typename === 'TweetTombstone') {
      throw new Error('Tweet is unavailable');
    }

    // Handle TweetWithVisibilityResults wrapper
    const tweetData = result.tweet || result;
    const legacy = tweetData.legacy;
    const core = tweetData.core?.user_results?.result;

    return {
      id: tweetData.rest_id,
      text: this.extractTweetText(tweetData),
      createdAt: legacy.created_at,
      user: core ? this.parseListTweetUser(core) : null as any,
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
      media: this.parseTweetMedia(legacy.extended_entities?.media),
    };
  }

  private parseListTweetUser(result: any): any {
    const legacy = result.legacy;
    return {
      id: result.id,
      restId: result.rest_id,
      name: legacy.name,
      screenName: legacy.screen_name,
      profileImageUrl: legacy.profile_image_url_https,
      verified: legacy.verified,
      isBlueVerified: result.is_blue_verified || false,
    };
  }

  private parseTweetMedia(media: any[]): any[] {
    if (!media) return [];
    
    return media.map(m => ({
      type: m.type,
      url: m.media_url_https,
      width: m.original_info?.width,
      height: m.original_info?.height,
      altText: m.ext_alt_text,
    }));
  }
}

/**
 * Extract list ID from URL or raw ID
 */
export function extractListId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Check URL patterns
  const urlMatch = /(?:twitter\.com|x\.com)\/i\/lists\/(\d+)/i.exec(trimmed);
  if (urlMatch) return urlMatch[1];

  // Check raw numeric ID (at least 5 digits)
  if (/^\d{5,}$/.test(trimmed)) return trimmed;

  return null;
}

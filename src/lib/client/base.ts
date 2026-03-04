import { request, ProxyAgent, Agent } from 'undici';
import { QueryIdManager } from '../query-ids/index.js';
import { RateLimiter } from '../rate-limit.js';
import { ProxyManager } from '../proxy.js';
import { generateTransactionId } from '../anti-detect/transaction.js';
import type { Session, ClientOptions, GraphQLResponse } from '../../types/twitter.js';

// Static bearer token (from Twitter web client)
const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export class BaseClient {
  protected session: Session;
  protected queryIds: QueryIdManager;
  protected rateLimiter: RateLimiter;
  protected proxyManager: ProxyManager | null;
  protected options: ClientOptions;

  /**
   * Extract tweet text with longform support.
   *
   * X/Twitter long tweets may store full content in `note_tweet...text` while
   * `legacy.full_text` contains only a preview ("show more" truncation).
   */
  protected extractTweetText(tweetData: any): string {
    const legacy = tweetData?.legacy;

    // Longform note tweet
    const note = tweetData?.note_tweet?.note_tweet_results?.result;
    const noteText =
      note?.text ??
      note?.richtext?.text ??
      note?.rich_text?.text ??
      note?.content?.text ??
      note?.content?.richtext?.text ??
      note?.content?.rich_text?.text;

    if (typeof noteText === 'string' && noteText.trim()) {
      return noteText;
    }

    // Fallback: classic tweet text
    const fullText = legacy?.full_text ?? legacy?.text ?? tweetData?.text;
    return typeof fullText === 'string' ? fullText : '';
  }

  constructor(session: Session, options: ClientOptions = {}) {
    this.session = session;
    this.options = {
      timeoutMs: 30000,
      delayMs: 500,
      jitterMs: 200,
      ...options,
    };
    this.queryIds = new QueryIdManager();
    this.rateLimiter = new RateLimiter();
    
    // Initialize proxy manager if proxy options provided
    this.proxyManager = (options.proxy || options.proxyFile)
      ? new ProxyManager({ proxy: options.proxy, proxyFile: options.proxyFile })
      : null;
  }

  protected getHeaders(): Record<string, string> {
    return {
      'authorization': `Bearer ${BEARER_TOKEN}`,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-csrf-token': this.session.ct0,
      'cookie': `auth_token=${this.session.authToken}; ct0=${this.session.ct0}`,
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'x-twitter-client-language': 'en',
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    };
  }

  protected async graphql<T>(
    operationName: string,
    variables: Record<string, unknown>,
    features?: Record<string, boolean>
  ): Promise<T> {
    const queryId = await this.queryIds.get(operationName);
    
    const defaultFeatures = {
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      articles_preview_enabled: true,
      tweetypie_unmention_optimization_enabled: true,
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
      rweb_video_timestamps_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_enhance_cards_enabled: false,
      // Added Jan 2026 - X API updates
      responsive_web_twitter_article_notes_tab_enabled: true,
      subscriptions_verification_info_verified_since_enabled: true,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      highlights_tweets_tab_ui_enabled: true,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      hidden_profile_subscriptions_enabled: true,
      subscriptions_feature_can_gift_premium: true,
      // Grok features
      responsive_web_grok_show_grok_translated_post: true,
      responsive_web_grok_analyze_post_followups_enabled: true,
      premium_content_api_read_enabled: true,
      responsive_web_grok_image_annotation_enabled: true,
      responsive_web_grok_share_attachment_enabled: true,
      responsive_web_grok_analysis_button_from_backend: true,
      responsive_web_grok_analyze_button_fetch_trends_enabled: true,
      rweb_video_screen_enabled: true,
      responsive_web_jetfuel_frame: true,
    };

    const mergedFeatures = features || defaultFeatures;
    const url = new URL(`https://x.com/i/api/graphql/${queryId}/${operationName}`);
    // SearchTimeline requires POST with features in body (Twitter API change)
    const usePost = operationName === 'SearchTimeline';
    url.searchParams.set('variables', JSON.stringify(variables));
    if (!usePost) {
      url.searchParams.set('features', JSON.stringify(mergedFeatures));
    }

    // Add jitter to avoid detection
    if (this.options.jitterMs) {
      await this.sleep(Math.random() * this.options.jitterMs);
    }

    // Check rate limits
    await this.rateLimiter.waitIfNeeded(operationName);

    const headers = this.getHeaders();
    headers['x-client-transaction-id'] = generateTransactionId();

    // Get proxy dispatcher if configured
    const dispatcher = this.getDispatcher();
    const currentProxy = this.proxyManager?.getCurrent();

    try {
      const requestOptions: Record<string, any> = {
        method: usePost ? 'POST' : 'GET',
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs!),
        dispatcher,
      };
      if (usePost) {
        requestOptions.body = JSON.stringify({ features: mergedFeatures, queryId });
      }
      const response = await request(url.toString(), requestOptions);

      // Mark proxy success
      if (currentProxy) {
        this.proxyManager?.markSuccess(currentProxy.url);
      }

      // Update rate limit tracking
      this.rateLimiter.update(operationName, {
        limit: parseInt(response.headers['x-rate-limit-limit'] as string) || 0,
        remaining: parseInt(response.headers['x-rate-limit-remaining'] as string) || 0,
        reset: parseInt(response.headers['x-rate-limit-reset'] as string) || 0,
      });

      const data = await response.body.json() as GraphQLResponse<T>;

      if (data.errors) {
        throw new Error(`GraphQL Error: ${data.errors.map(e => e.message).join(', ')}`);
      }

      return data.data;
    } catch (error) {
      // Mark proxy failure and rotate
      if (currentProxy) {
        this.proxyManager?.markFailed(currentProxy.url);
        // Rotate to next proxy
        this.proxyManager?.getNext();
      }
      throw error;
    }
  }

  /**
   * Get undici dispatcher (proxy agent if configured, undefined otherwise)
   */
  protected getDispatcher(): ProxyAgent | undefined {
    if (!this.proxyManager?.hasProxies()) {
      return undefined;
    }

    const proxy = this.proxyManager.getNext();
    if (!proxy) {
      return undefined;
    }

    const { uri, auth } = this.proxyManager.formatForUndici(proxy);
    
    return new ProxyAgent({
      uri,
      token: auth,
    });
  }

  /**
   * Get proxy stats (for debugging)
   */
  getProxyStats(): { total: number; available: number; disabled: number } | null {
    return this.proxyManager?.getStats() || null;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

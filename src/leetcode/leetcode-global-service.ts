import { Credential, LeetCode } from "leetcode-query";
import {
    assertRunStartResponse,
    assertSubmitStartResponse,
    buildLeetCodeHeaders,
    buildLeetCodeHttpAuth,
    pollCheck,
    postJson
} from "../utils/leetcode-http.js";
import logger from "../utils/logger.js";
import * as favoriteApi from "./favorite-api.js";
import { GraphQLRequest } from "./favorite-api.js";
import { SEARCH_PROBLEMS_QUERY } from "./graphql/global/search-problems.js";
import { SOLUTION_ARTICLE_DETAIL_QUERY } from "./graphql/global/solution-article-detail.js";
import { SOLUTION_ARTICLES_QUERY } from "./graphql/global/solution-articles.js";
import {
    LeetCodeBaseService,
    type RandomProblem
} from "./leetcode-base-service.js";
import * as questionLookupApi from "./question-lookup-api.js";
import { inspectSessionCookie, type SessionInfo } from "./session-info.js";

/**
 * LeetCode Global API Service Implementation
 *
 * This class provides methods to interact with the LeetCode Global API
 */
export class LeetCodeGlobalService implements LeetCodeBaseService {
    private readonly leetCodeApi: LeetCode;
    private readonly credential: Credential;
    private readonly origin = "https://leetcode.com";

    constructor(leetCodeApi: LeetCode, credential: Credential) {
        this.leetCodeApi = leetCodeApi;
        this.credential = credential;
    }

    private getHttpHeaders(titleSlug: string): HeadersInit {
        const auth = buildLeetCodeHttpAuth({
            session: this.credential.session ?? "",
            csrfToken: this.credential.csrf ?? ""
        });

        const referer = `${this.origin}/problems/${titleSlug}/`;
        return buildLeetCodeHeaders({
            auth,
            origin: this.origin,
            referer
        });
    }

    async fetchUserSubmissionDetail(id: number): Promise<any> {
        if (!this.isAuthenticated()) {
            throw new Error(
                "Authentication required to fetch user submission detail"
            );
        }
        return await this.leetCodeApi.submission(id);
    }

    async fetchUserStatus(): Promise<any> {
        if (!this.isAuthenticated()) {
            throw new Error("Authentication required to fetch user status");
        }
        return await this.leetCodeApi.whoami().then((res) => {
            return {
                isSignedIn: res?.isSignedIn ?? false,
                username: res?.username ?? "",
                avatar: res?.avatar ?? "",
                isAdmin: res?.isAdmin ?? false
            };
        });
    }

    async fetchUserAllSubmissions(options: {
        offset: number;
        limit: number;
        questionSlug?: string;
        lastKey?: string;
        lang?: string;
        status?: string;
    }): Promise<any> {
        if (!this.isAuthenticated()) {
            throw new Error(
                "Authentication required to fetch user submissions"
            );
        }
        const submissions = await this.leetCodeApi.submissions({
            offset: options.offset ?? 0,
            limit: options.limit ?? 20,
            slug: options.questionSlug
        });
        return { submissions };
    }

    /**
     * 获取用户最近的提交记录
     * @param username
     * @param limit
     * @returns
     */
    async fetchUserRecentSubmissions(
        username: string,
        limit?: number
    ): Promise<any> {
        return await this.leetCodeApi.recent_submissions(username, limit);
    }

    /**
     * 获取用户最近 AC 的提交记录
     * @param username
     * @param limit
     * @returns
     */
    async fetchUserRecentACSubmissions(
        username: string,
        limit?: number
    ): Promise<any> {
        return await this.leetCodeApi.graphql({
            query: `
                    query ($username: String!, $limit: Int) {
                        recentAcSubmissionList(username: $username, limit: $limit) {
                            id
                            title
                            titleSlug
                            time
                            timestamp
                            statusDisplay
                            lang
                        }
                    }

                `,
            variables: {
                username,
                limit
            }
        });
    }

    async fetchUserProfile(username: string): Promise<any> {
        const profile = await this.leetCodeApi.user(username);
        if (profile && profile.matchedUser) {
            const { matchedUser } = profile;

            return {
                username: matchedUser.username,
                realName: matchedUser.profile.realName,
                userAvatar: matchedUser.profile.userAvatar,
                countryName: matchedUser.profile.countryName,
                githubUrl: matchedUser.githubUrl,
                company: matchedUser.profile.company,
                school: matchedUser.profile.school,
                ranking: matchedUser.profile.ranking,
                totalSubmissionNum: matchedUser.submitStats?.totalSubmissionNum
            };
        }
        return profile;
    }

    async fetchUserContestRanking(
        username: string,
        attended: boolean = true
    ): Promise<any> {
        const contestInfo = await this.leetCodeApi.user_contest_info(username);
        if (contestInfo.userContestRankingHistory && attended) {
            contestInfo.userContestRankingHistory =
                contestInfo.userContestRankingHistory.filter((contest: any) => {
                    return contest && contest.attended;
                });
        }
        return contestInfo;
    }

    async fetchDailyChallenge(): Promise<any> {
        const dailyChallenge = await this.leetCodeApi.daily();
        return dailyChallenge;
    }

    async fetchProblem(titleSlug: string): Promise<any> {
        const problem = await this.leetCodeApi.problem(titleSlug);
        return problem;
    }

    async fetchProblemSimplified(titleSlug: string): Promise<any> {
        const problem = await this.fetchProblem(titleSlug);
        if (!problem) {
            throw new Error(`Problem ${titleSlug} not found`);
        }

        const filteredTopicTags =
            problem.topicTags?.map((tag: any) => tag.slug) || [];

        const filteredCodeSnippets =
            problem.codeSnippets?.filter((snippet: any) =>
                ["cpp", "python3", "java"].includes(snippet.langSlug)
            ) || [];

        let parsedSimilarQuestions: any[] = [];
        if (problem.similarQuestions) {
            try {
                const allQuestions = JSON.parse(problem.similarQuestions);
                parsedSimilarQuestions = allQuestions
                    .slice(0, 3)
                    .map((q: any) => ({
                        titleSlug: q.titleSlug,
                        difficulty: q.difficulty
                    }));
            } catch (e) {
                logger.error("Error parsing similarQuestions: %s", e);
            }
        }

        return {
            titleSlug,
            questionId: problem.questionId,
            title: problem.title,
            content: problem.content,
            difficulty: problem.difficulty,
            topicTags: filteredTopicTags,
            codeSnippets: filteredCodeSnippets,
            exampleTestcases: problem.exampleTestcases,
            hints: problem.hints,
            similarQuestions: parsedSimilarQuestions
        };
    }

    async searchProblems(
        category?: string,
        tags?: string[],
        difficulty?: string,
        limit: number = 10,
        offset: number = 0,
        searchKeywords?: string
    ): Promise<any> {
        const filters: any = {};
        if (difficulty) {
            filters.difficulty = difficulty.toUpperCase();
        }
        if (tags && tags.length > 0) {
            filters.tags = tags;
        }
        if (searchKeywords) {
            filters.searchKeywords = searchKeywords;
        }

        const response = await this.leetCodeApi.graphql({
            query: SEARCH_PROBLEMS_QUERY,
            variables: {
                categorySlug: category,
                limit,
                skip: offset,
                filters
            }
        });

        const questionList = response.data?.problemsetQuestionList;
        if (!questionList) {
            return {
                total: 0,
                questions: []
            };
        }
        return {
            total: questionList.total,
            questions: questionList.questions.map((question: any) => ({
                title: question.title,
                titleSlug: question.titleSlug,
                difficulty: question.difficulty,
                acRate: question.acRate,
                topicTags: question.topicTags.map((tag: any) => tag.slug)
            }))
        };
    }

    async fetchUserProgressQuestionList(options?: {
        offset?: number;
        limit?: number;
        questionStatus?: string;
        difficulty?: string[];
    }): Promise<any> {
        if (!this.isAuthenticated()) {
            throw new Error(
                "Authentication required to fetch user progress question list"
            );
        }

        const filters = {
            skip: options?.offset || 0,
            limit: options?.limit || 20,
            questionStatus: options?.questionStatus as any,
            difficulty: options?.difficulty as any[]
        };

        return await this.leetCodeApi.user_progress_questions(filters);
    }

    /**
     * Retrieves a list of solutions for a specific problem.
     *
     * @param questionSlug - The URL slug/identifier of the problem
     * @param options - Optional parameters for filtering and sorting the solutions
     * @returns Promise resolving to the solutions list data
     */
    async fetchQuestionSolutionArticles(
        questionSlug: string,
        options?: any
    ): Promise<any> {
        const variables: any = {
            questionSlug,
            first: options?.limit || 5,
            skip: options?.skip || 0,
            orderBy: options?.orderBy || "HOT",
            userInput: options?.userInput,
            tagSlugs: options?.tagSlugs ?? []
        };

        return await this.leetCodeApi
            .graphql({
                query: SOLUTION_ARTICLES_QUERY,
                variables
            })
            .then((res) => {
                const ugcArticleSolutionArticles =
                    res.data?.ugcArticleSolutionArticles;
                if (!ugcArticleSolutionArticles) {
                    return {
                        totalNum: 0,
                        hasNextPage: false,
                        articles: []
                    };
                }
                const data = {
                    totalNum: ugcArticleSolutionArticles?.totalNum || 0,
                    hasNextPage:
                        ugcArticleSolutionArticles?.pageInfo?.hasNextPage ||
                        false,
                    articles:
                        ugcArticleSolutionArticles?.edges
                            ?.map((edge: any) => {
                                if (
                                    edge?.node &&
                                    edge.node.topicId &&
                                    edge.node.slug
                                ) {
                                    edge.node.articleUrl = `https://leetcode.com/problems/${questionSlug}/solutions/${edge.node.topicId}/${edge.node.slug}`;
                                }
                                return edge.node;
                            })
                            .filter((node: any) => node && node.canSee) || []
                };

                return data;
            });
    }

    /**
     * Retrieves detailed information about a specific solution on LeetCode Global.
     *
     * @param topicId - The topic ID of the solution
     * @returns Promise resolving to the solution detail data
     */
    async fetchSolutionArticleDetail(topicId: string): Promise<any> {
        return await this.leetCodeApi
            .graphql({
                query: SOLUTION_ARTICLE_DETAIL_QUERY,
                variables: {
                    topicId
                }
            })
            .then((response) => {
                return response.data?.ugcArticleSolutionArticle;
            });
    }

    /**
     * Note feature is not supported in LeetCode Global.
     * This method is implemented to satisfy the interface but will always throw an error.
     *
     * @param options - Query parameters (not used)
     * @throws Error indicating the feature is not supported on Global platform
     */
    async fetchUserNotes(options: {
        aggregateType: string;
        keyword?: string;
        orderBy?: string;
        limit?: number;
        skip?: number;
    }): Promise<any> {
        throw new Error("Notes feature is not supported in LeetCode Global");
    }

    /**
     * Note feature is not supported in LeetCode Global.
     * This method is implemented to satisfy the interface but will always throw an error.
     *
     * @param questionId - The question ID (not used)
     * @param limit - Maximum number of notes (not used)
     * @param skip - Pagination offset (not used)
     * @throws Error indicating the feature is not supported on Global platform
     */
    async fetchNotesByQuestionId(
        questionId: string,
        limit?: number,
        skip?: number
    ): Promise<any> {
        throw new Error("Notes feature is not supported in LeetCode Global");
    }

    /**
     * Note feature is not supported in LeetCode Global.
     * This method is implemented to satisfy the interface but will always throw an error.
     */
    async createUserNote(
        content: string,
        noteType: string,
        targetId: string,
        summary: string
    ): Promise<any> {
        throw new Error("Notes feature is not supported in LeetCode Global");
    }

    /**
     * Note feature is not supported in LeetCode Global.
     * This method is implemented to satisfy the interface but will always throw an error.
     */
    async updateUserNote(
        noteId: string,
        content: string,
        summary: string
    ): Promise<any> {
        throw new Error("Notes feature is not supported in LeetCode Global");
    }

    async pickRandomProblem(options: {
        difficulty?: string;
        tag?: string;
    }): Promise<RandomProblem> {
        const unsolvedOnly = this.isAuthenticated();
        const filters: Record<string, unknown> = {};
        if (options.difficulty) {
            filters.difficulty = options.difficulty.toUpperCase();
        }
        if (options.tag) {
            filters.tags = [options.tag];
        }
        if (unsolvedOnly) {
            filters.status = "NOT_STARTED";
        }
        const query = `
            query ($limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
                questionList(categorySlug: "", limit: $limit, skip: $skip, filters: $filters) {
                    totalNum
                    data { titleSlug title difficulty isPaidOnly topicTags { slug } }
                }
            }`;
        const page = async (skip: number, limit: number) => {
            const response = await this.leetCodeApi.graphql({
                query,
                variables: { limit, skip, filters }
            });
            return response?.data?.questionList;
        };

        const total = Number((await page(0, 1))?.totalNum ?? 0);
        if (!total) {
            throw new Error(
                `No ${unsolvedOnly ? "unsolved " : ""}problems match difficulty '${options.difficulty ?? "any"}' and topic '${options.tag ?? "any"}'`
            );
        }
        const pageSize = 50;
        for (let attempt = 0; attempt < 4; attempt++) {
            const skip = Math.floor(
                Math.random() * Math.max(1, total - pageSize + 1)
            );
            const free = ((await page(skip, pageSize))?.data ?? []).filter(
                (q: any) => !q.isPaidOnly
            );
            if (free.length) {
                const q = free[Math.floor(Math.random() * free.length)];
                const slugs = (q.topicTags ?? []).map((t: any) => t.slug);
                // LeetCode ignores unknown tags instead of failing, so check.
                if (options.tag && !slugs.includes(options.tag)) {
                    throw new Error(
                        `Unknown topic '${options.tag}'. Use a LeetCode topic tag slug such as 'graph', 'dynamic-programming' or 'sliding-window'.`
                    );
                }
                return {
                    titleSlug: q.titleSlug,
                    title: q.title,
                    difficulty: q.difficulty,
                    topicTags: (q.topicTags ?? []).map((t: any) => t.slug),
                    unsolvedOnly
                };
            }
        }
        throw new Error("Only premium problems match these filters");
    }

    /** Problems per GraphQL request when reading notes in bulk. */
    private static readonly NOTE_BATCH_SIZE = 50;

    async fetchProblemNote(titleSlug: string): Promise<string | null> {
        const notes = await this.fetchProblemNotes([titleSlug]);
        return notes[titleSlug] ?? null;
    }

    async fetchProblemNotes(
        titleSlugs: string[]
    ): Promise<Record<string, string | null>> {
        this.requireAuthentication("read problem notes");
        const result: Record<string, string | null> = {};
        const unique = [...new Set(titleSlugs)];
        const size = LeetCodeGlobalService.NOTE_BATCH_SIZE;

        for (let start = 0; start < unique.length; start += size) {
            const batch = unique.slice(start, start + size);
            // One aliased field per problem: q0: question(titleSlug: $s0) { note }
            const params = batch.map((_, i) => `$s${i}: String!`).join(", ");
            const fields = batch
                .map((_, i) => `q${i}: question(titleSlug: $s${i}) { note }`)
                .join("\n");
            const variables = Object.fromEntries(
                batch.map((slug, i) => [`s${i}`, slug])
            );
            const response = await this.leetCodeApi.graphql({
                query: `query (${params}) {\n${fields}\n}`,
                variables
            });
            batch.forEach((slug, i) => {
                const note = response?.data?.[`q${i}`]?.note;
                result[slug] = typeof note === "string" && note ? note : null;
            });
        }
        return result;
    }

    async updateProblemNote(titleSlug: string, content: string): Promise<void> {
        this.requireAuthentication("update problem notes");
        const response = await this.leetCodeApi.graphql({
            query: `
                mutation ($titleSlug: String!, $content: String!) {
                    updateNote(titleSlug: $titleSlug, content: $content) {
                        ok
                        error
                    }
                }
            `,
            variables: { titleSlug, content }
        });
        const outcome = response?.data?.updateNote;
        if (!outcome) {
            throw new Error(
                "LeetCode did not accept the note update (is LEETCODE_SESSION still valid?)"
            );
        }
        if (!outcome.ok) {
            throw new Error(
                `LeetCode rejected the note update: ${outcome.error || "unknown error"}`
            );
        }
    }

    async runCode(params: {
        titleSlug: string;
        questionId: string;
        lang: string;
        typedCode: string;
        dataInput?: string;
        timeoutMs?: number;
        pollIntervalMs?: number;
    }): Promise<{
        start: Record<string, unknown>;
        checkUrl: string;
        check: Record<string, unknown>;
    }> {
        if (!this.isAuthenticated()) {
            throw new Error("Authentication required to run code");
        }

        const headers = this.getHttpHeaders(params.titleSlug);
        const startUrl = `${this.origin}/problems/${params.titleSlug}/interpret_solution/`;

        const start = await postJson(
            startUrl,
            {
                data_input: params.dataInput ?? "",
                lang: params.lang,
                question_id: params.questionId,
                typed_code: params.typedCode
            },
            headers
        );

        assertRunStartResponse(start, `POST ${startUrl}`);

        const checkUrl = `${this.origin}/submissions/detail/${start.interpret_id}/check/`;
        const check = await pollCheck(checkUrl, headers, {
            timeoutMs: params.timeoutMs,
            pollIntervalMs: params.pollIntervalMs
        });

        return { start, checkUrl, check };
    }

    async submitSolution(params: {
        titleSlug: string;
        questionId: string;
        lang: string;
        typedCode: string;
        timeoutMs?: number;
        pollIntervalMs?: number;
    }): Promise<{
        start: Record<string, unknown>;
        checkUrl: string;
        check: Record<string, unknown>;
    }> {
        if (!this.isAuthenticated()) {
            throw new Error("Authentication required to submit solution");
        }

        const headers = this.getHttpHeaders(params.titleSlug);
        const startUrl = `${this.origin}/problems/${params.titleSlug}/submit/`;

        const start = await postJson(
            startUrl,
            {
                lang: params.lang,
                question_id: params.questionId,
                typed_code: params.typedCode
            },
            headers
        );

        assertSubmitStartResponse(start, `POST ${startUrl}`);

        const checkUrl = `${this.origin}/submissions/detail/${start.submission_id}/check/`;
        const check = await pollCheck(checkUrl, headers, {
            timeoutMs: params.timeoutMs,
            pollIntervalMs: params.pollIntervalMs
        });

        return { start, checkUrl, check };
    }

    /**
     * Executes a raw GraphQL request with the client's session credentials.
     * Used by the shared problem list (favorites) operations.
     */
    private readonly executeGraphQL = (request: GraphQLRequest): Promise<any> =>
        this.leetCodeApi.graphql(request);

    private requireAuthentication(action: string): void {
        if (!this.isAuthenticated()) {
            throw new Error(`Authentication required to ${action}`);
        }
    }

    async fetchMyFavoriteLists(options?: {
        includeCollected?: boolean;
    }): Promise<any> {
        this.requireAuthentication("fetch problem lists");
        return await favoriteApi.fetchMyFavoriteLists(
            this.executeGraphQL,
            options
        );
    }

    async fetchFavoriteDetail(favoriteSlug: string): Promise<any> {
        this.requireAuthentication("fetch problem list details");
        return await favoriteApi.fetchFavoriteDetail(
            this.executeGraphQL,
            favoriteSlug
        );
    }

    async fetchFavoriteQuestions(
        favoriteSlug: string,
        options?: favoriteApi.FetchFavoriteQuestionsOptions
    ): Promise<any> {
        this.requireAuthentication("fetch problem list questions");
        return await favoriteApi.fetchFavoriteQuestions(
            this.executeGraphQL,
            favoriteSlug,
            options
        );
    }

    async resolveQuestionsByFrontendId(
        questionIds: Array<string | number>
    ): Promise<any> {
        this.requireAuthentication("look up problems by number");
        return await questionLookupApi.resolveQuestionsByFrontendId(
            this.executeGraphQL,
            questionIds
        );
    }

    async reorderFavoriteQuestions(
        favoriteSlug: string,
        options: favoriteApi.ReorderFavoriteQuestionsOptions
    ): Promise<any> {
        this.requireAuthentication("reorder problem lists");
        return await favoriteApi.reorderFavoriteQuestions(
            this.executeGraphQL,
            favoriteSlug,
            options
        );
    }

    async createFavorite(options: {
        name: string;
        description?: string;
        isPublic?: boolean;
    }): Promise<any> {
        this.requireAuthentication("create problem lists");
        return await favoriteApi.createFavorite(this.executeGraphQL, options);
    }

    async updateFavoriteNameDescription(
        favoriteSlug: string,
        name: string,
        description?: string
    ): Promise<any> {
        this.requireAuthentication("update problem lists");
        return await favoriteApi.updateFavoriteNameDescription(
            this.executeGraphQL,
            favoriteSlug,
            name,
            description
        );
    }

    async updateFavoriteIsPublic(
        favoriteSlug: string,
        isPublic: boolean
    ): Promise<any> {
        this.requireAuthentication("update problem lists");
        return await favoriteApi.updateFavoriteIsPublic(
            this.executeGraphQL,
            favoriteSlug,
            isPublic
        );
    }

    async addQuestionsToFavorite(
        favoriteSlug: string,
        questionSlugs: string[]
    ): Promise<any> {
        this.requireAuthentication("add questions to problem lists");
        return await favoriteApi.addQuestionsToFavorite(
            this.executeGraphQL,
            favoriteSlug,
            questionSlugs
        );
    }

    async removeQuestionsFromFavorite(
        favoriteSlug: string,
        questionSlugs: string[]
    ): Promise<any> {
        this.requireAuthentication("remove questions from problem lists");
        return await favoriteApi.removeQuestionsFromFavorite(
            this.executeGraphQL,
            favoriteSlug,
            questionSlugs
        );
    }

    isAuthenticated(): boolean {
        return (
            !!this.credential &&
            !!this.credential.csrf &&
            !!this.credential.session
        );
    }

    inspectSession(): SessionInfo | undefined {
        return this.credential?.session
            ? inspectSessionCookie(this.credential.session)
            : undefined;
    }

    isCN(): boolean {
        return false;
    }
}

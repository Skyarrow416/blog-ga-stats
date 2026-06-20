// 用服务账号调用 GA4 Data API，抓取「访问来源 Top N」和「热门文章 Top N」，
// 输出到 ga-data.json。由 GitHub Actions 定时运行。
//
// 需要的环境变量（在 GitHub Secrets 中配置）：
//   GA_PROPERTY_ID        GA4 媒体资源 ID（纯数字，不是 G-xxxx）
//   GA_SA_KEY             服务账号 JSON 密钥的完整内容
// 可选：
//   GA_DAYS               统计时间范围（天），默认 30
//   GA_TOP_N              每个榜单取前几名，默认 10

const fs = require('fs');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

const PROPERTY_ID = process.env.GA_PROPERTY_ID;
const DAYS = parseInt(process.env.GA_DAYS || '30', 10);
const TOP_N = parseInt(process.env.GA_TOP_N || '10', 10);

if (!PROPERTY_ID) {
  console.error('缺少 GA_PROPERTY_ID 环境变量');
  process.exit(1);
}
if (!process.env.GA_SA_KEY) {
  console.error('缺少 GA_SA_KEY 环境变量');
  process.exit(1);
}

const credentials = JSON.parse(process.env.GA_SA_KEY);
const client = new BetaAnalyticsDataClient({ credentials });

const dateRange = { startDate: `${DAYS}daysAgo`, endDate: 'today' };

async function fetchReferrers() {
  const [resp] = await client.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [dateRange],
    dimensions: [{ name: 'sessionSource' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: TOP_N + 1, // 多取一个，便于过滤掉 (direct)
  });
  return (resp.rows || [])
    .map((r) => ({
      source: r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value, 10),
    }))
    .filter((r) => r.source && r.source !== '(direct)' && r.source !== '(not set)')
    .slice(0, TOP_N);
}

async function fetchTopPosts() {
  const [resp] = await client.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [dateRange],
    dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
    metrics: [{ name: 'screenPageViews' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: TOP_N + 5,
  });
  return (resp.rows || [])
    .map((r) => ({
      path: r.dimensionValues[0].value,
      title: r.dimensionValues[1].value,
      views: parseInt(r.metricValues[0].value, 10),
    }))
    // 过滤掉首页/归档/分类等非文章页
    .filter((r) => r.path && r.path !== '/' && !/^\/(archives|categories|tags|about)/.test(r.path))
    .slice(0, TOP_N);
}

(async () => {
  try {
    const [referrers, posts] = await Promise.all([fetchReferrers(), fetchTopPosts()]);
    const out = {
      updated: new Date().toISOString(),
      rangeDays: DAYS,
      referrers,
      posts,
    };
    fs.writeFileSync('ga-data.json', JSON.stringify(out, null, 2));
    console.log(`已写入 ga-data.json：来源 ${referrers.length} 条，文章 ${posts.length} 条`);
  } catch (err) {
    console.error('抓取失败：', err.message);
    process.exit(1);
  }
})();

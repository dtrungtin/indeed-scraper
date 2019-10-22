const Apify = require('apify');
const rp = require('request-promise');
const cheerio = require('cheerio');

Apify.main(async () => {
    const input = await Apify.getInput();
    console.log('Input:');
    console.log(input);

    if (!input || !Array.isArray(input.startURLs) || input.startURLs.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startURLs'.");
    }

    const requestQueue = await Apify.openRequestQueue();

    for (let index = 0; index < input.startURLs; index++) {
        await requestQueue.addRequest({ url: input.startURLs[index], userData: { label: 'start' } });
    }

    const basicCrawler = new Apify.BasicCrawler({
        requestQueue,
        handleRequestFunction: async ({ request }) => {
            if (request.userData.label === 'start' || request.userData.label === 'list') {
                const body = await rp(request.url);
                const $ = cheerio.load(body);
                const content = $('meta[name=description]').attr('content').split(/\s+/)[0].replace('.', '').replace(',', '');
                const pageCount = Math.floor(parseInt(content, 10) / 10);

                if (request.userData.label === 'start') {
                    for (let index = 1; index < pageCount; index++) {
                        const startNumber = index * 10;
                        await requestQueue.addRequest({ url: `${request.url}&start=${startNumber}`, userData: { label: 'list' } });
                    }
                }

                const jobLinks = $('.result');
                for (let index = 1; index < jobLinks.length; index++) {
                    const jk = $(jobLinks[index]).attr('data-jk');
                    await requestQueue.addRequest({ url: `https://vn.indeed.com/viewjob?jk=${jk}`, userData: { label: 'job', jobKey: jk } });
                }
            } else if (request.userData.label === 'job') {
                const body = await rp(request.url);
                const $ = cheerio.load(body);
                const jobDesription = $('#jobDescriptionText').text();
                const jobLocation = $('.jobsearch-JobMetadataHeader-iconLabel').text();
                const jobTitle = $('.jobsearch-JobInfoHeader-title').text();

                await Apify.pushData({
                    url: request.url,
                    id: request.userData.jobKey,
                    positionName: jobTitle,
                    location: jobLocation,
                    description: jobDesription,
                    '#debug': Apify.utils.createRequestDebugInfo(request),
                });
            }
        },

        handleFailedRequestFunction: async ({ request }) => {
            await Apify.pushData({
                '#isFailed': true,
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },

        maxRequestsPerCrawl: input.maxItems,
    });

    await basicCrawler.run();
});

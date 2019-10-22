const Apify = require('apify');
const rp = require('request-promise');
// eslint-disable-next-line import/no-extraneous-dependencies
const cheerio = require('cheerio');

Apify.main(async () => {
    const input = await Apify.getInput();

    if (!input || typeof (input.url) !== 'string') {
        throw new Error("Invalid input, it needs to contain 'url' field.");
    }

    const requestQueue = await Apify.openRequestQueue();
    await requestQueue.addRequest({ url: input.url, userData: { label: 'start' } });

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
                    await requestQueue.addRequest({ url: `https://vn.indeed.com/viewjob?jk=${jk}&from=vjs`, userData: { label: 'job', jobKey: jk } });
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
    });

    await basicCrawler.run();
});

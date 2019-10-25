const Apify = require('apify');
const _ = require('underscore');
const safeEval = require('safe-eval');

Apify.main(async () => {
    const input = await Apify.getInput();
    console.log('Input:');
    console.log(input);

    if (!input || !Array.isArray(input.startURLs) || input.startURLs.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startURLs'.");
    }

    const dataset = await Apify.openDataset();
    const { itemCount } = dataset;

    let pagesOutputted = itemCount;
    const requestQueue = await Apify.openRequestQueue();

    for (let index = 0; index < input.startURLs; index++) {
        await requestQueue.addRequest({ url: input.startURLs[index].url, userData: { label: 'start' } });
    }

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        handlePageFunction: async ({ request, response, html, $ }) => {
            if (request.userData.label === 'start' || request.userData.label === 'list') {
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
                const jobDesription = $('#jobDescriptionText').text();
                const jobLocation = $('.jobsearch-JobMetadataHeader-iconLabel').text();
                const jobTitle = $('.jobsearch-JobInfoHeader-title').text();

                const extendedResult = safeEval(input.extendOutputFunction)($);

                const result = {
                    url: request.url,
                    id: request.userData.jobKey,
                    positionName: jobTitle,
                    location: jobLocation,
                    description: jobDesription,
                    '#debug': Apify.utils.createRequestDebugInfo(request),
                };

                _.extend(result, extendedResult);

                await Apify.pushData(result);

                if (++pagesOutputted >= input.maxItems) {
                    const msg = `Outputted ${pagesOutputted} pages, limit is ${input.maxItems} pages`;
                    console.log(`Shutting down the crawler: ${msg}`);
                    this.autoscaledPool.abort();
                }
            }
        },

        handleFailedRequestFunction: async ({ request }) => {
            await Apify.pushData({
                '#isFailed': true,
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },

        proxyConfiguration: input.proxyConfiguration,
    });

    await crawler.run();
});

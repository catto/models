'use strict';

const BaseFactory = require('./baseFactory');
const Build = require('./build');
const hoek = require('hoek');
let instance;

/**
 * Gathers a sha for the build
 * @method getCommitSha
 * @param  {Object}         config
 * @param  {JobModel}       config.job                  Instance of Job Model
 * @param  {Scm}            config.scmPlugin            Instance of scmPlugin
 * @param  {Object}         config.modelConfig          Configuration passed to the build model
 * @param  {String}         [config.modelConfig.sha]    The sha we are ultimately looking for
 * @param  {String}         config.modelConfig.username The name of the user
 * @return {Promise}
 */
function getCommitSha(config) {
    // Short circuit if sha already defined
    if (config.modelConfig.sha) {
        return Promise.resolve(config.modelConfig.sha);
    }

    // Lazy load factory dependency to prevent circular dependency issues
    // https://nodejs.org/api/modules.html#modules_cycles
    /* eslint-disable global-require */
    const UserFactory = require('./userFactory');
    /* eslint-enable global-require */

    const userFactory = UserFactory.getInstance();

    // Fetch user and pipeline
    return Promise.all([
        userFactory.get({ username: config.modelConfig.username }),
        config.job.pipeline
    ]).then(([user, pipeline]) => {
        if (!user) {
            throw new Error('User does not exist');
        }

        if (!pipeline) {
            throw new Error('Pipeline does not exist');
        }

        return user.unsealToken()
            .then(token => config.scmPlugin.getCommitSha({
                scmUrl: pipeline.scmUrl,
                token
            }));
    });
}

class BuildFactory extends BaseFactory {
    /**
     * Construct a JobFactory object
     * @method constructor
     * @param  {Object}    config
     * @param  {Object}    config.datastore     Object that will perform datastore operations
     * @param  {Object}    config.executor      Object that will perform compute operations
     * @param  {String}    config.uiUri         Partial Uri including hostname and namespace for ui for git notifications
     */
    constructor(config) {
        super('build', config);
        this.executor = config.executor;
        this.uiUri = config.uiUri;
        this.apiUri = null;
        this.tokenGen = null;
    }

    /**
     * Instantiate a Build class
     * @method createClass
     * @param  {Object}     config               Build data
     * @param  {String}     config.id            unique id
     * @param  {Datastore}  config.datastore     Datastore instance
     * @param  {String}     config.username      The user that created this build
     * @param  {String}     config.jobId         The ID of the associated job to start
     * @param  {String}     [config.sha]         The sha of the build
     * @param  {String}     [config.container]   The kind of container to use
     * @return {Build}
     */
    createClass(config) {
        // add executor to config
        const c = hoek.applyToDefaults(config, {
            executor: this.executor,
            apiUri: this.apiUri,
            tokenGen: this.tokenGen,
            uiUri: this.uiUri
        });

        return new Build(c);
    }

    /**
     * Create a new Build
     * @method create
     * @param  {Object}    config                Config object
     * @param  {String}    config.jobId          The job associated with this build
     * @param  {String}    config.username       The user that created this build
     * @param  {String}    [config.sha]          The sha of the build
     * @return {Promise}
     */
    create(config) {
        const number = Date.now();
        const createTime = (new Date(number)).toISOString();
        const modelConfig = hoek.applyToDefaults(config, {
            cause: `Started by user ${config.username}`,
            createTime,
            number,
            status: 'QUEUED'
        });

        // Lazy load factory dependency to prevent circular dependency issues
        // https://nodejs.org/api/modules.html#modules_cycles
        /* eslint-disable global-require */
        const JobFactory = require('./jobFactory');
        /* eslint-enable global-require */
        const factory = JobFactory.getInstance();

        return factory.get(config.jobId)
            .then(job => {
                if (!job) {
                    throw new Error('Job does not exist');
                }

                return getCommitSha({ job, scmPlugin: this.scmPlugin, modelConfig })
                    .then(sha => {
                        // TODO: support matrix jobs
                        const index = number.toString().split('.')[1] || 0;
                        const permutation = job.permutations[index];

                        modelConfig.sha = sha;
                        modelConfig.container = permutation.image;
                        modelConfig.steps = permutation.commands.map((command) => ({
                            name: command.name
                        }));
                        modelConfig.steps.unshift({ name: 'sd-setup' });
                        modelConfig.steps.push({ name: 'sd-teardown' });

                        return super.create(modelConfig);
                    })
                    .then(build => build.start());
            });
    }

    /**
     * Gets all the builds for a given jobId
     * @method getBuildsForJobId
     * @param  {Object}   config                Config object
     * @param  {String}   config.jobId          The jobId of the build to filter for
     * @return {Promise}                        List of Build models
     */
    getBuildsForJobId(config) {
        const listConfig = {
            params: {
                jobId: config.jobId
            },
            paginate: {
                count: 25, // This limit is set by the matrix restriction
                page: 1
            }
        };

        return this.list(listConfig)
            .then((records) => records.sort((build1, build2) => build1.number - build2.number));
    }

    /**
     * Get an instance of the BuildFactory
     * @method getInstance
     * @param  {Object}     [config]            Configuration required for first call
     * @param  {Datastore}  config.datastore    Datastore instance
     * @param  {Executor}   config.executor     Executor instance
     * @param  {Datastore}  config.scmPlugin    A scm plugin instance
     * @return {BuildFactory}
     */
    static getInstance(config) {
        if (!instance && (!config || !config.executor)) {
            throw new Error('No executor provided to BuildFactory');
        }
        if (!instance && (!config || !config.uiUri)) {
            throw new Error('No uiUri provided to BuildFactory');
        }
        if (!instance && (!config || !config.scmPlugin)) {
            throw new Error('No scm plugin provided to BuildFactory');
        }

        instance = BaseFactory.getInstance(BuildFactory, instance, config);

        return instance;
    }
}

module.exports = BuildFactory;

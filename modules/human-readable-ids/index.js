//todo support translates
window.HumanReadableIds = {
    create: function() {
        return this.encode(Math.floor(Math.random() *
            this.nouns.length*this.verbs.length*this.adjectives.length*this.adverbs.length));
    },

    encode: function (number) {
        const adjectiveFactor = 1,
            nounFactor = adjectiveFactor * this.adjectives.length,
            verbFactor = nounFactor * this.nouns.length,
            adverbFactor = verbFactor * this.verbs.length;

        let remainder = number % adverbFactor,
            adverb = this.adverbs[(number - remainder) / adverbFactor],
            verb, adjective, noun;

        if (adverb === undefined) throw "Number out of range! " + number;

        number = remainder;
        remainder = number % verbFactor;
        verb = this.verbs[(number - remainder) / verbFactor];

        number = remainder;
        remainder = number % nounFactor;
        noun = this.nouns[(number - remainder) / nounFactor];

        number = remainder;
        remainder = number % adjectiveFactor;
        adjective = this.adjectives[(number - remainder) / adjectiveFactor];

        return [adjective, noun, verb, adverb].join(" ");
    },

    // Parse a Greg sentence and return it's corresponding id
    parse: function(sentence) {
        const words = sentence.split(" "),
            adjectiveFactor = 1,
            nounFactor = adjectiveFactor * this.adjectives.length,
            verbFactor = nounFactor * this.nouns.length,
            adverbFactor = verbFactor * this.verbs.length,
            adjective = this.adjectives.indexOf(words[0]),
            noun = this.nouns.indexOf(words[1]),
            verb = this.verbs.indexOf(words[2]),
            adverb = this.adverbs.indexOf(words[3]);

        return adjectiveFactor * adjective
            + nounFactor * noun
            + verbFactor * verb
            + adverbFactor * adverb;
    },

    // English adjectives
    adjectives: ['cute', 'happy', 'unhappy', 'sad', 'angry', 'calm', 'loud', 'quiet', 'fast', 'slow', 'big', 'small',
        'tall', 'short', 'bright', 'dark', 'hot', 'cold', 'soft', 'hard', 'sweet', 'sour', 'dapper', 'large',
        'long', 'thick', 'narrow', 'deep', 'flat', 'whole', 'low', 'high', 'near', 'far', 'quick', 'early', 'late',
        'cloudy', 'warm', 'cool', 'windy', 'noisy', 'dry', 'clear', 'heavy', 'light', 'strong', 'weak', 'tidy',
        'clean', 'dirty', 'empty', 'full', 'close', 'thirsty', 'hungry', 'fat', 'old', 'fresh', 'dead', 'healthy',
        'bitter', 'salty', 'good', 'bad', 'great', 'important', 'useful', 'expensive', 'cheap', 'free', 'difficult',
        'able', 'rich', 'afraid', 'brave', 'fine', 'proud', 'comfortable', 'clever', 'interesting', 'famous',
        'exciting', 'funny', 'kind', 'polite', 'fair', 'shared', 'busy', 'lazy', 'lucky', 'careful', 'safe', 'dangerous'],

    // English nouns (all animals)
    nouns: ['rabbits', 'badgers', 'foxes', 'chickens', 'bats', 'deer', 'snakes', 'hares', 'hedgehogs',
        'platypuses', 'moles', 'mice', 'otters', 'rats', 'squirrels', 'stoats', 'weasels', 'crows',
        'doves', 'ducks', 'geese', 'hawks', 'herons', 'kingfishers', 'owls', 'peafowl', 'pheasants',
        'pigeons', 'robins', 'rooks', 'sparrows', 'starlings', 'swans', 'ants', 'bees', 'butterflies',
        'dragonflies', 'flies', 'moths', 'spiders', 'pikes', 'salmons', 'trouts', 'frogs', 'newts',
        'toads', 'crabs', 'lobsters', 'clams', 'cockles', 'mussles', 'oysters', 'snails', 'cattle',
        'dogs', 'donkeys', 'goats', 'horses', 'pigs', 'sheep', 'ferrets', 'gerbils',
        'parrots', 'greg', 'cat', 'dog', 'fish', 'bird', 'hamster', 'rabbit',
        'turtle', 'mouse', 'rat', 'squirrel', 'horse', 'cow', 'pig', 'goat', 'chicken', 'duck',
        'goose', 'turkey', 'penguin', 'elephant', 'lion', 'tiger', 'leopard', 'zebra', 'giraffe',
        'monkey', 'ape', 'gorilla', 'kangaroo', 'koala', 'panda', 'bat', 'snake', 'lizard', 'crocodile',
        'rhinoceros', 'buffalo', 'octopus'
    ],

    // English verbs, past tense
    verbs: ['sang', 'played', 'knitted', 'floundered', 'danced', 'listened', 'ran', 'talked', 'cuddled', 'sat', 'kissed',
        'hugged', 'whimpered', 'hid', 'fought', 'whispered', 'cried', 'snuggled', 'walked', 'drove', 'loitered', 'felt',
        'jumped', 'hopped', 'went', 'married', 'engaged', 'came', 'looked', 'watched', 'thought', 'slept', 'ate', 'drank',
        'read', 'wrote', 'spoke', 'took', 'gave', 'made', 'found', 'lost', 'built', 'bought', 'sold', 'sent', 'received',
        'kept', 'spent', 'broke', 'fixed', 'stood', 'grew', 'cut', 'drew', 'heard', 'told', 'smiled', 'laughed', 'screamed',
        'yawned', 'waved', 'worked', 'studied', 'learned', 'taught'],

    // English adverbs
    adverbs: ['jovially', 'merrily', 'cordially', 'carefully', 'correctly', 'eagerly', 'easily', 'fast', 'loudly',
        'patiently', 'quietly', 'always', 'often', 'sometimes', 'rarely', 'usually', 'simply', 'quickly', 'happily',
        'sadly', 'calmly', 'softly', 'gently', 'kindly', 'angrily', 'completely', 'nearly', 'now', 'then', 'there',
        'here', 'soon', 'late', 'early', 'again', 'together', 'apart', 'already', 'naturally', 'perfectly', 'exactly',
        'slowly', 'deeply', 'politely', 'generously', 'cheerfully', 'anxiously', 'excitedly', 'nervously', 'gracefully',
        'awkwardly', 'honestly', 'sincerely', 'openly', 'boldly', 'shyly', 'noisily', 'steadily', 'firmly', 'roughly',
        'directly', 'indirectly', 'certainly', 'definitely', 'absolutely', 'possibly', 'maybe', 'hopefully', 'truly',
        'finally', 'recently'],
}

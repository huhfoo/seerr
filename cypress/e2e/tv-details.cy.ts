describe('TV Details', () => {
  it('loads a tv details page', () => {
    cy.loginAsAdmin();
    // Try to load stranger things
    cy.visit('/tv/66732');

    cy.get('[data-testid=media-title]').should(
      'contain',
      'Stranger Things (2016)'
    );
  });

  it('shows seasons and expands episodes', () => {
    cy.loginAsAdmin();

    // Try to load stranger things
    cy.visit('/tv/66732');

    // intercept request for season info
    cy.intercept('/api/v1/tv/66732/season/4').as('season4');

    cy.contains('Season 4').should('be.visible').scrollIntoView().click();

    cy.wait('@season4');

    cy.contains('Chapter Nine').should('be.visible');
  });

  it('allows requesting a season partially downloaded directly in Sonarr', () => {
    cy.loginAsAdmin();
    cy.request('/api/v1/tv/66732').then(({ body }) => {
      cy.intercept('GET', '/api/v1/tv/66732', {
        ...body,
        mediaInfo: {
          id: 999,
          mediaType: 'tv',
          tmdbId: 66732,
          status: 4, // Partially available
          status4k: 1, // Unknown
          requests: [],
          issues: [],
          seasons: [
            {
              seasonNumber: 1,
              status: 4, // Partially available
              status4k: 1, // Unknown
            },
          ],
        },
      }).as('partialSeries');
    });
    // No real request or download is submitted by this test.
    cy.intercept('POST', '/api/v1/request', {
      statusCode: 201,
      body: { media: { status: 3 } },
    }).as('seasonRequest');
    cy.visit('/tv/66732');
    cy.wait('@partialSeries');
    cy.contains('button', 'Request More').click();
    cy.contains('tbody tr', 'Season 1').find('[role="checkbox"]').click();
    cy.contains('button', 'Request 1 Season').should('be.enabled').click();
    cy.wait('@seasonRequest').then(({ request }) => {
      expect(request.body.seasons).to.deep.equal([1]);
      expect(request.body.episodes).to.equal(undefined);
    });
  });
});
